import type { AzureTarget } from '../config.js';
import { parseResult, SYSTEM_PROMPT, userPrompt } from './anthropic.js';
import type { Rewriter, RewriteInput, RewriteResult } from './types.js';

type Fetch = typeof fetch;

/** Azure OpenAI through the v1 chat completions API. Same prompt and JSON reply as the Claude provider. */
export class AzureOpenAIRewriter implements Rewriter {
  readonly name: string;

  constructor(
    private target: AzureTarget,
    private timeoutMs: number,
    private doFetch: Fetch = fetch,
  ) {
    this.name = `azure:${target.deployment}`;
  }

  async rewrite(input: RewriteInput): Promise<RewriteResult> {
    const url = `${this.target.endpoint.replace(/\/+$/, '')}/openai/v1/chat/completions`;
    const res = await this.doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': this.target.apiKey },
      body: JSON.stringify({
        model: this.target.deployment,
        // Room for reasoning models, which spend tokens before they answer.
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`rewriter http ${res.status}`);

    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const result = parseResult(data.choices?.[0]?.message?.content ?? '');
    result.inputTokens = data.usage?.prompt_tokens;
    result.outputTokens = data.usage?.completion_tokens;
    return result;
  }
}

/** Tries the main rewriter, and the fallback only if the main one throws. */
export class FallbackRewriter implements Rewriter {
  readonly name: string;

  constructor(
    private main: Rewriter,
    private fallback: Rewriter,
  ) {
    this.name = `${main.name}, then ${fallback.name}`;
  }

  async rewrite(input: RewriteInput): Promise<RewriteResult> {
    try {
      return await this.main.rewrite(input);
    } catch {
      return this.fallback.rewrite(input);
    }
  }
}
