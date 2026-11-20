import { describe, expect, it } from 'vitest';
import { isOpenAi, requestBody } from './llm.ts';

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('requestBody (provider param mapping)', () => {
  const openai = { baseUrl: 'https://api.openai.com/v1', extraBody: {} };
  const glm = {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    extraBody: { thinking: { type: 'disabled' } },
  };

  it('detects OpenAI by host only', () => {
    expect(isOpenAi('https://api.openai.com/v1')).toBe(true);
    expect(isOpenAi('https://example.com/api.openai.com')).toBe(false);
    expect(isOpenAi('not a url')).toBe(false);
  });

  it('sends max_completion_tokens and reasoning_effort, never temperature or max_tokens, to OpenAI', () => {
    const body = requestBody(openai, 'gpt-5.5', messages, {
      maxTokens: 4000,
      reasoningEffort: 'medium',
      temperature: 0.5,
    });
    expect(body).toMatchObject({
      model: 'gpt-5.5',
      max_completion_tokens: 4000,
      reasoning_effort: 'medium',
      response_format: { type: 'json_object' },
    });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('omits reasoning_effort for OpenAI when not requested', () => {
    expect(requestBody(openai, 'gpt-5.5', messages)).not.toHaveProperty('reasoning_effort');
  });

  it('sends max_tokens and temperature, and no reasoning_effort, to other providers', () => {
    const body = requestBody(glm, 'glm-5.3-flash', messages, { reasoningEffort: 'low' });
    expect(body).toMatchObject({
      max_tokens: 8192,
      temperature: 0.1,
      thinking: { type: 'disabled' },
    });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(requestBody(glm, 'm', messages, { temperature: 0.3, maxTokens: 100 })).toMatchObject({
      temperature: 0.3,
      max_tokens: 100,
    });
  });
});
