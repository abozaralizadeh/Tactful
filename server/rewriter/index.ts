import type { Config } from '../config.js';
import { AnthropicRewriter } from './anthropic.js';
import { FakeRewriter } from './fake.js';
import type { Rewriter } from './types.js';

export function createRewriter(config: Config): Rewriter {
  if (config.rewriter === 'anthropic') {
    return new AnthropicRewriter(config.anthropicApiKey, config.anthropicModel, config.rewriteTimeoutMs);
  }
  return new FakeRewriter();
}

export type { Rewriter, RewriteInput, RewriteResult, Outcome } from './types.js';
