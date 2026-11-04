import type { Config } from '../config.js';
import { AnthropicRewriter } from './anthropic.js';
import { AzureOpenAIRewriter, FallbackRewriter } from './azure.js';
import { FakeRewriter } from './fake.js';
import type { Rewriter } from './types.js';

export function createRewriter(config: Config): Rewriter {
  if (config.rewriter === 'anthropic') {
    return new AnthropicRewriter(config.anthropicApiKey, config.anthropicModel, config.rewriteTimeoutMs);
  }
  if (config.rewriter === 'azure') {
    const main = new AzureOpenAIRewriter(config.azure, config.rewriteTimeoutMs);
    return config.azureFallback ? new FallbackRewriter(main, new AzureOpenAIRewriter(config.azureFallback, config.rewriteTimeoutMs)) : main;
  }
  return new FakeRewriter();
}

export type { Rewriter, RewriteInput, RewriteResult, Outcome } from './types.js';
