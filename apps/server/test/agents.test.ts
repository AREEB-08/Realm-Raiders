import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryRepo, type AgentRequest } from '@realm/core';
import { RoleOutputs, type GeneralOutput } from '@realm/shared';
import { LlmAgents } from '../src/agents/runner';

/** A recorded-fixture LLM stub: an OpenAI-compatible /chat/completions with scripted replies. */
let server: Server;
let base = '';
let mode: 'good' | 'tool' | 'bad' | 'slow' = 'good';
let calls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const parsed = JSON.parse(body) as { messages: { role: string }[] };
      const reply = (content: unknown) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: content }] }));
      };
      if (mode === 'slow') {
        setTimeout(() => reply({ role: 'assistant', content: '{"greeting":"late"}' }), 6000);
        return;
      }
      if (mode === 'bad') return reply({ role: 'assistant', content: 'I refuse to speak JSON.' });
      if (mode === 'tool' && !parsed.messages.some((m) => m.role === 'tool'))
        return reply({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_targets', arguments: '{"max":3}' } }] });
      return reply({ role: 'assistant', content: '```json\n{"greeting":"Hail, commander.","briefing":["Kragmoor is ripe."],"suggestedTarget":"kragmoor"}\n```' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const runner = () =>
  new LlmAgents({ mode: 'live', providers: [{ name: 'stub', baseUrl: base, apiKey: 'k', model: 'qwen-stub' }], timeoutMs: 4000, ratePerMinute: 30, cacheMs: 0 }, new MemoryRepo());

const req = (extra: Partial<AgentRequest<GeneralOutput>> = {}): AgentRequest<GeneralOutput> => ({
  role: 'general' as const,
  task: 'briefing',
  playerId: 'p1',
  facts: { general: 'Brannoc', personality: 'bold' },
  schema: RoleOutputs.general,
  fallback: (): GeneralOutput => ({ greeting: 'Field manual greeting.', briefing: [], suggestedTarget: null }),
  ...extra,
});

describe('agent runtime', () => {
  it('returns schema-valid LLM output', async () => {
    mode = 'good';
    const r = await runner().run(req());
    expect(r.fallback).toBe(false);
    expect(r.output.greeting).toBe('Hail, commander.');
  });

  it('runs a tool round and validates tool arguments', async () => {
    mode = 'tool';
    let toolArgs: unknown = null;
    const r = await runner().run(req({ tools: { list_targets: (a) => ((toolArgs = a), [{ islandId: 'kragmoor' }]) } }));
    expect(toolArgs).toEqual({ max: 3 });
    expect(r.fallback).toBe(false);
  });

  it('game-rule check rejects an invented target → fallback', async () => {
    mode = 'good';
    const r = await runner().run(req({ check: (o) => (o.suggestedTarget === 'kragmoor' ? 'not listed' : null) }));
    expect(r.fallback).toBe(true);
  });

  it('invalid JSON twice → fallback', async () => {
    mode = 'bad';
    calls = 0;
    const r = await runner().run(req());
    expect(r.fallback).toBe(true);
    expect(calls).toBe(2); // one repair retry
  });

  it('slow LLM → fallback in under 4.2 s', async () => {
    mode = 'slow';
    const t0 = Date.now();
    const r = await runner().run(req());
    expect(r.fallback).toBe(true);
    expect(Date.now() - t0).toBeLessThan(4200);
  }, 10_000);

  it('rate limit: the 31st call in a minute is the field manual', async () => {
    mode = 'good';
    const a = new LlmAgents({ mode: 'live', providers: [{ name: 'stub', baseUrl: base, apiKey: 'k', model: 'm' }], timeoutMs: 4000, ratePerMinute: 2, cacheMs: 0 }, new MemoryRepo());
    await a.run(req());
    await a.run(req());
    expect((await a.run(req())).fallback).toBe(true);
  });
});

describe('grounding guardrail', () => {
  it('rejects numbers that are not in the facts, allows grounded ones and m:ss times', async () => {
    const { ungrounded } = await import('../src/agents/runner');
    expect(ungrounded({ t: 'win rate 72% with 120 men' }, [{ winRate: 100 }])).toMatch(/72, 120/);
    expect(ungrounded({ t: 'Kragmoor: 2400 loot at 1:30' }, [{ loot: 2400 }])).toBeNull();
  });
});
