export interface AzureTarget {
  endpoint: string;
  apiKey: string;
  deployment: string;
}

export interface Config {
  port: number;
  host: string;
  /** false, true, or the proxy addresses to trust (for example 127.0.0.1). */
  trustProxy: boolean | string;
  dbPath: string;
  logDir: string;
  logMaxBytes: number;
  logMaxFiles: number;
  rewriter: 'fake' | 'anthropic' | 'azure';
  anthropicApiKey: string;
  anthropicModel: string;
  /** Azure OpenAI: the main deployment, and an optional fallback tried when the main one fails. */
  azure: AzureTarget;
  azureFallback: AzureTarget | null;
  rewriteTimeoutMs: number;
  retentionDays: number;
  draftTtlMinutes: number;
  maxMessageChars: number;
  maxTopicChars: number;
  maxNameChars: number;
  dailyRewriteCap: number;
  /** Most AI tokens (in plus out) per day across the service. 0 means no budget. */
  dailyTokenBudget: number;
  ratePerIpRewritesPerHour: number;
  rateCreatePerHour: number;
  rateJoinPerHour: number;
  rateDraftPerMinute: number;
  webDir: string;
}

const num = (env: NodeJS.ProcessEnv, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a positive number`);
  return value;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rewriter = env.REWRITER ?? 'fake';
  if (rewriter !== 'fake' && rewriter !== 'anthropic' && rewriter !== 'azure') {
    throw new Error(`REWRITER must be "fake", "anthropic" or "azure", got "${rewriter}"`);
  }
  if (rewriter === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('REWRITER=anthropic needs ANTHROPIC_API_KEY');
  }
  const azure = { endpoint: env.AZURE_OPENAI_ENDPOINT ?? '', apiKey: env.AZURE_OPENAI_API_KEY ?? '', deployment: env.AZURE_OPENAI_DEPLOYMENT ?? '' };
  if (rewriter === 'azure' && !(azure.endpoint && azure.apiKey && azure.deployment)) {
    throw new Error('REWRITER=azure needs AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT');
  }
  const fb = { endpoint: env.AZURE_OPENAI_FALLBACK_ENDPOINT ?? '', apiKey: env.AZURE_OPENAI_FALLBACK_API_KEY ?? '', deployment: env.AZURE_OPENAI_FALLBACK_DEPLOYMENT ?? '' };
  const trust = env.TRUST_PROXY ?? 'false';
  return {
    port: num(env, 'PORT', 3000),
    host: env.HOST ?? '127.0.0.1',
    trustProxy: trust === 'true' ? true : trust === 'false' || trust === '' ? false : trust,
    dbPath: env.DB_PATH ?? 'data/tactful.db',
    logDir: env.LOG_DIR ?? 'logs',
    logMaxBytes: num(env, 'LOG_MAX_BYTES', 10 * 1024 * 1024),
    logMaxFiles: num(env, 'LOG_MAX_FILES', 5),
    rewriter,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    azure,
    azureFallback: fb.endpoint && fb.apiKey && fb.deployment ? fb : null,
    rewriteTimeoutMs: num(env, 'REWRITE_TIMEOUT_MS', 20000),
    retentionDays: num(env, 'RETENTION_DAYS', 30),
    draftTtlMinutes: num(env, 'DRAFT_TTL_MINUTES', 60),
    maxMessageChars: num(env, 'MAX_MESSAGE_CHARS', 2000),
    maxTopicChars: num(env, 'MAX_TOPIC_CHARS', 300),
    maxNameChars: num(env, 'MAX_NAME_CHARS', 40),
    dailyRewriteCap: num(env, 'DAILY_REWRITE_CAP', 2000),
    dailyTokenBudget: num(env, 'DAILY_TOKEN_BUDGET', 0),
    ratePerIpRewritesPerHour: num(env, 'RATE_REWRITES_PER_IP_PER_HOUR', 60),
    rateCreatePerHour: num(env, 'RATE_CREATE_PER_HOUR', 10),
    rateJoinPerHour: num(env, 'RATE_JOIN_PER_HOUR', 20),
    rateDraftPerMinute: num(env, 'RATE_DRAFT_PER_MINUTE', 20),
    webDir: env.WEB_DIR ?? 'dist/web',
  };
}
