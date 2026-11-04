import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, keccakUtf8, playerText, toolsFor, ToolArgs, type ToolName } from '@realm/shared';
import { uid, type AgentRequest, type AgentResult, type AgentRunner, type Repo } from '@realm/core';
import { z } from 'zod';
import { chat, extractJson, LlmError, type ChatMessage, type LlmProvider } from './llm';

const here = dirname(fileURLToPath(import.meta.url));
const prompt = (name: string) => readFileSync(join(here, 'prompts', `${name}.md`), 'utf8').trim();
const PREAMBLE = prompt('_preamble');
const ROLE_PROMPTS: Record<string, string> = {
  general: prompt('general'),
  architect: prompt('architect'),
  strategist: prompt('strategist'),
  night_captain: prompt('night_captain'),
  intel: prompt('intel'),
};

export interface AgentConfig {
  mode: 'live' | 'offline';
  providers: LlmProvider[];
  timeoutMs: number;
  /** Max agent calls per player per minute (§14.6). */
  ratePerMinute: number;
  cacheMs: number;
}

/**
 * The officer runtime (§14): role prompt + allowed tools + output schema, at most 3 tool rounds,
 * one repair retry, then the rule-based fallback. Agents propose; the caller's `check` and the
 * services decide. Responses are cached by (role, task, facts) for 10 minutes.
 */
export class LlmAgents implements AgentRunner {
  private cache = new Map<string, { at: number; output: unknown }>();
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly cfg: AgentConfig,
    private readonly repo: Repo,
    private readonly log: (m: string, x?: unknown) => void = () => {},
  ) {}

  get live() {
    return this.cfg.mode === 'live' && this.cfg.providers.length > 0;
  }

  private allow(playerId: string) {
    const now = Date.now();
    const list = (this.buckets.get(playerId) ?? []).filter((t) => now - t < 60_000);
    if (list.length >= this.cfg.ratePerMinute) return false;
    list.push(now);
    this.buckets.set(playerId, list);
    return true;
  }

  async run<T>(req: AgentRequest<T>): Promise<AgentResult<T>> {
    const t0 = Date.now();
    const inputHash = keccakUtf8(canonicalJson({ role: req.role, task: req.task, facts: req.facts, text: req.playerText ?? '' }));
    const finish = async (output: T, fallback: boolean): Promise<AgentResult<T>> => {
      const latencyMs = Date.now() - t0;
      try {
        await this.repo.agentLog.put({ id: uid('al_'), playerId: req.playerId, role: req.role, task: req.task, inputHash, output, latencyMs, fallback, createdAt: Date.now() });
        if (!fallback)
          await this.repo.agentMemory.put({
            id: uid('am_'),
            playerId: req.playerId,
            role: req.role,
            kind: 'fact',
            content: JSON.stringify(output).slice(0, 200),
            createdAt: Date.now(),
          });
      } catch {
        /* logging must never break a request */
      }
      return { output, fallback, latencyMs };
    };
    if (!this.live || !this.allow(req.playerId)) return finish(req.fallback(), true);
    const cached = this.cache.get(inputHash);
    if (cached && Date.now() - cached.at < this.cfg.cacheMs) return { output: cached.output as T, fallback: false, latencyMs: 0 };

    const deadline = t0 + this.cfg.timeoutMs;
    try {
      const output = await this.ask(req, deadline);
      this.cache.set(inputHash, { at: Date.now(), output });
      return finish(output, false);
    } catch (e) {
      this.log(`agent ${req.role}/${req.task} fell back: ${(e as Error).message}`);
      return finish(req.fallback(), true);
    }
  }

  private async memories(playerId: string, role: string) {
    try {
      const rows = await this.repo.agentMemory.find((m) => m.playerId === playerId && m.role === role);
      return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10).map((m) => m.content);
    } catch {
      return [];
    }
  }

  private async ask<T>(req: AgentRequest<T>, deadline: number): Promise<T> {
    const general = String((req.facts.general as string | undefined) ?? 'the General');
    const system = [
      PREAMBLE.replace(/\{\{generalName\}\}/g, general),
      (ROLE_PROMPTS[req.role] ?? '').replace(/\{\{generalName\}\}/g, general).replace(/\{\{personality\}\}/g, String(req.facts.personality ?? 'Steadfast')),
      `Reply with a single JSON object matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(req.schema as z.ZodType))}`,
    ].join('\n\n');
    const user = [
      `TASK: ${req.task}`,
      `FACTS: ${JSON.stringify(req.facts).slice(0, 6000)}`,
      `MEMORY: ${JSON.stringify(await this.memories(req.playerId, req.role))}`,
      req.playerText ? `PLAYER: ${playerText(req.playerText)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const allTools = req.tools ? toolsFor(req.role).filter((t) => req.tools![t.function.name]) : [];
    let lastError: Error | null = null;
    for (const provider of this.cfg.providers) {
      // Qwen3's soft switch: answer directly (no hidden reasoning) to stay inside the time budget.
      const userMsg = /qwen3/i.test(provider.model) ? `${user}
/no_think` : user;
      // A local model answers from FACTS in one round (every service already passes the grounded
      // data); tool rounds are kept for hosted models that fit several calls inside the budget.
      const tools = provider.name === 'local' ? [] : allTools;
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ];
      try {
        let repairs = 0;
        for (let round = 0; round < 6; round++) {
          const left = deadline - Date.now();
          if (left <= 150) throw new LlmError('deadline', false);
          const { message } = await chat(provider, messages, { tools: round < 3 ? tools : [], timeoutMs: left, json: true });
          if (message.tool_calls?.length && round < 3) {
            messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });
            for (const call of message.tool_calls) {
              messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(await this.tool(req, call.function.name, call.function.arguments)) });
            }
            continue;
          }
          try {
            const parsed = req.schema.parse(extractJson(message.content));
            const problem = req.check?.(parsed) ?? ungrounded(parsed, [req.facts, ...messages.filter((m) => m.role === 'tool').map((m) => m.content)]);
            if (problem) throw new Error(problem);
            return parsed;
          } catch (e) {
            if (repairs++ >= 1) throw new LlmError(`invalid output: ${(e as Error).message}`, false);
            messages.push({ role: 'assistant', content: message.content ?? '' });
            messages.push({ role: 'user', content: `That answer was invalid (${(e as Error).message.slice(0, 200)}). Reply with the JSON object only.` });
          }
        }
        throw new LlmError('too many rounds', false);
      } catch (e) {
        lastError = e as Error;
        // Network/timeouts move on to the next provider; invalid output does not.
        if (!(e instanceof LlmError) || !e.retryable) throw e;
      }
    }
    throw lastError ?? new Error('no provider');
  }

  /** Tool calls are validated with zod; out-of-range arguments are rejected (§14.6). */
  private async tool<T>(req: AgentRequest<T>, name: string, rawArgs: string) {
    const handler = req.tools?.[name];
    const schema = ToolArgs[name as ToolName];
    if (!handler || !schema) return { error: `tool ${name} is not available to ${req.role}` };
    let args: unknown;
    try {
      args = schema.parse(JSON.parse(rawArgs || '{}'));
    } catch (e) {
      return { error: `invalid arguments: ${(e as Error).message.slice(0, 200)}` };
    }
    try {
      return await handler(args);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
}

/**
 * Grounding guardrail (§14.1 rule 6): every number the officer writes must appear in FACTS or in
 * a tool result. 0 and 1 and m:ss times are allowed. Returns a problem or null.
 */
export function ungrounded(output: unknown, sources: unknown[]): string | null {
  const known = new Set<string>();
  for (const src of sources) for (const n of JSON.stringify(src ?? '').match(/\d+(?:\.\d+)?/g) ?? []) {
    known.add(n);
    known.add(String(Math.round(Number(n))));
  }
  const text = JSON.stringify(output).replace(/\d+:\d{2}/g, '');
  const bad = (text.match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => Number(n) > 1 && !known.has(n) && !known.has(String(Math.round(Number(n)))));
  return bad.length ? `you quoted numbers that are not in FACTS: ${[...new Set(bad)].slice(0, 5).join(', ')}` : null;
}

export function providersFromEnv(env: {
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL: string;
  LLM_FALLBACK_BASE_URL?: string;
  LLM_FALLBACK_API_KEY?: string;
  LLM_FALLBACK_MODEL: string;
  LLM_LOCAL_BASE_URL?: string;
  LLM_LOCAL_MODEL: string;
}): LlmProvider[] {
  const out: LlmProvider[] = [];
  if (env.LLM_BASE_URL && env.LLM_API_KEY) out.push({ name: 'primary', baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
  if (env.LLM_FALLBACK_BASE_URL && env.LLM_FALLBACK_API_KEY)
    out.push({ name: 'fallback', baseUrl: env.LLM_FALLBACK_BASE_URL, apiKey: env.LLM_FALLBACK_API_KEY, model: env.LLM_FALLBACK_MODEL });
  if (env.LLM_LOCAL_BASE_URL) out.push({ name: 'local', baseUrl: env.LLM_LOCAL_BASE_URL, apiKey: undefined, model: env.LLM_LOCAL_MODEL });
  return out;
}
