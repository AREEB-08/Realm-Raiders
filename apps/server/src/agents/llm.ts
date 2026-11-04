/**
 * One OpenAI-compatible chat client for every provider (Model Studio → OpenRouter → Ollama).
 * Switching provider is env-only (§14.1 rule 1).
 */
export interface LlmProvider {
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatResult {
  message: ChatMessage;
  provider: string;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function chat(
  provider: LlmProvider,
  messages: ChatMessage[],
  opts: { tools?: unknown[]; timeoutMs: number; signal?: AbortSignal; json?: boolean },
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const abort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', abort);
  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'content-type': 'application/json',
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: 0.4,
        max_tokens: 400,
        ...(opts.tools?.length ? { tools: opts.tools, tool_choice: 'auto' } : {}),
        ...(opts.json && !opts.tools?.length ? { response_format: { type: 'json_object' } } : {}),
        // Qwen3 thinking mode off: fast, schema-shaped answers. Ollama ignores /no_think and
        // enable_thinking but honours reasoning_effort "none" (1.7 s vs 10 s on a laptop GPU).
        ...(provider.name === 'local' ? { reasoning_effort: 'none' } : { enable_thinking: false }),
      }),
    });
    if (!res.ok) throw new LlmError(`${provider.name} HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { choices?: { message: ChatMessage }[] };
    const message = body.choices?.[0]?.message;
    if (!message) throw new LlmError(`${provider.name}: empty response`, true);
    return { message, provider: provider.name };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(`${provider.name}: ${(e as Error).name === 'AbortError' ? 'timeout' : (e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', abort);
  }
}

/** Pull a JSON object out of a model reply (tolerates code fences and leading prose). */
export function extractJson(text: string | null | undefined): unknown {
  if (!text) throw new Error('empty reply');
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in reply');
  return JSON.parse(cleaned.slice(start, end + 1));
}
