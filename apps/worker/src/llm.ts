import { z } from 'zod';
import { bump, createLimiter, errorMessage, type Stats, sleep } from './util.ts';

export interface LlmConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string | undefined;
  /** Extra request-body fields for provider quirks, e.g. GLM's `thinking`. */
  extraBody: Record<string, unknown>;
  /** Per-request timeout; reasoning models need more than the default. */
  timeoutMs?: number;
}

export type ReasoningEffort = 'low' | 'medium' | 'high';

/** Per-call overrides. Provider-specific ones are ignored where the provider does not take them. */
export interface CallOptions {
  /** OpenAI reasoning models only. */
  reasoningEffort?: ReasoningEffort;
  /** Output cap (for OpenAI reasoning models it includes the hidden reasoning tokens). */
  maxTokens?: number;
  /** Ignored by OpenAI, whose reasoning models reject a non-default temperature. */
  temperature?: number;
}

export interface JsonRequest<T> extends CallOptions {
  system: string;
  user: string;
  /** Validate and shape the decoded JSON; throw with a readable message to trigger a repair round. */
  parse: (raw: unknown) => T;
}

export interface Llm {
  json<T>(request: JsonRequest<T>): Promise<T>;
}

/** Adapter for `JsonRequest.parse` backed by a zod schema. */
export const zodParse =
  <T>(schema: z.ZodType<T>) =>
  (raw: unknown): T => {
    const result = schema.safeParse(raw);
    if (!result.success) throw new Error(z.prettifyError(result.error));
    return result.data;
  };

export type Message = { role: 'system' | 'user' | 'assistant'; content: string };

const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
// Deal JSON plus evidence quotes can exceed 4k tokens; truncation yields invalid JSON.
const MAX_OUTPUT_TOKENS = 8192;

/** api.openai.com is the one provider whose chat API differs: `max_completion_tokens`, no temperature. */
export function isOpenAi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/** The request body for one completion, mapped to what the provider accepts. */
export function requestBody(
  config: Pick<LlmConfig, 'extraBody'> & { baseUrl: string },
  model: string,
  messages: Message[],
  options: CallOptions = {},
): Record<string, unknown> {
  const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS;
  const provider = isOpenAi(config.baseUrl)
    ? {
        max_completion_tokens: maxTokens,
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      }
    : { max_tokens: maxTokens, temperature: options.temperature ?? 0.1 };
  return {
    model,
    messages,
    response_format: { type: 'json_object' },
    ...provider,
    ...config.extraBody,
  };
}

class RetryableError extends Error {
  retryAfterMs: number | null;
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

function decodeJson(content: string): unknown {
  const body = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(body);
}

export function createLlm(
  config: LlmConfig,
  stats: Stats,
  signal: AbortSignal,
  concurrency = 2,
): Llm {
  const limit = createLimiter(concurrency);

  async function attempt(messages: Message[], options: CallOptions): Promise<string> {
    const { baseUrl, apiKey, model } = config;
    if (!baseUrl || !apiKey || !model)
      throw new Error('LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set');
    let response: Response;
    try {
      response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody({ ...config, baseUrl }, model, messages, options)),
        signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS)]),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new RetryableError(`LLM network error: ${errorMessage(error)}`);
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new RetryableError(
        `LLM HTTP ${response.status}`,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`LLM HTTP ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      usage?: { total_tokens?: number };
    };
    bump(stats, 'llmCalls');
    bump(stats, 'tokens', data.usage?.total_tokens ?? 0);
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      bump(stats, 'truncated');
      throw new Error(
        `LLM output truncated (finish_reason=length, cap ${options.maxTokens ?? MAX_OUTPUT_TOKENS} tokens)`,
      );
    }
    const content = choice?.message?.content;
    if (!content) throw new RetryableError('LLM returned an empty message');
    return content;
  }

  /** One completion with retry and backoff on 429, 5xx and network failures. */
  function complete(messages: Message[], options: CallOptions): Promise<string> {
    return limit(async () => {
      for (let n = 1; ; n++) {
        try {
          return await attempt(messages, options);
        } catch (error) {
          if (!(error instanceof RetryableError) || n >= MAX_ATTEMPTS || signal.aborted)
            throw error;
          const backoff = error.retryAfterMs ?? 1000 * 2 ** (n - 1) + Math.random() * 500;
          await sleep(Math.min(backoff, 20_000), signal);
        }
      }
    });
  }

  return {
    async json<T>({ system, user, parse, ...options }: JsonRequest<T>): Promise<T> {
      const messages: Message[] = [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ];
      let problem = '';
      for (let round = 0; round < 2; round++) {
        const content = await complete(messages, options);
        try {
          return parse(decodeJson(content));
        } catch (error) {
          problem =
            error instanceof SyntaxError ? `invalid JSON: ${error.message}` : errorMessage(error);
          messages.push(
            { role: 'assistant', content },
            {
              role: 'user',
              content: `Your JSON was rejected:\n${problem}\nReturn the complete corrected JSON object only.`,
            },
          );
        }
      }
      throw new Error(`LLM output rejected after repair: ${problem.slice(0, 300)}`);
    },
  };
}
