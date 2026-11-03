export type Outcome = 'rewritten' | 'needs_clarity' | 'stopped';

export interface RewriteInput {
  original: string;
  topic: string;
  /** Last few approved messages, oldest first. Context only. */
  recent: { who: 'sender' | 'other'; text: string }[];
}

export interface RewriteResult {
  outcome: Outcome;
  /** The calmer version. Only set when outcome is "rewritten". */
  text?: string;
  /** A short note for the sender when nothing was rewritten. */
  reason?: string;
  /** Show the support links on the stopped screen. */
  showSupport?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

/** The only door to the AI. Anything that rewrites messages implements this. */
export interface Rewriter {
  readonly name: string;
  rewrite(input: RewriteInput): Promise<RewriteResult>;
}
