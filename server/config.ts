export interface Config {
  port: number;
  host: string;
  trustProxy: boolean;
  dbPath: string;
  logDir: string;
  logMaxBytes: number;
  logMaxFiles: number;
  rewriter: 'fake' | 'anthropic';
  anthropicApiKey: string;
  anthropicModel: string;
  rewriteTimeoutMs: number;
  retentionDays: number;
  draftTtlMinutes: number;
  maxMessageChars: number;
  maxTopicChars: number;
  maxNameChars: number;
  dailyRewriteCap: number;
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
  if (rewriter !== 'fake' && rewriter !== 'anthropic') {
    throw new Error(`REWRITER must be "fake" or "anthropic", got "${rewriter}"`);
  }
  if (rewriter === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('REWRITER=anthropic needs ANTHROPIC_API_KEY');
  }
  return {
    port: num(env, 'PORT', 3000),
    host: env.HOST ?? '127.0.0.1',
    trustProxy: env.TRUST_PROXY === 'true',
    dbPath: env.DB_PATH ?? 'data/tactful.db',
    logDir: env.LOG_DIR ?? 'logs',
    logMaxBytes: num(env, 'LOG_MAX_BYTES', 10 * 1024 * 1024),
    logMaxFiles: num(env, 'LOG_MAX_FILES', 5),
    rewriter,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5',
    rewriteTimeoutMs: num(env, 'REWRITE_TIMEOUT_MS', 20000),
    retentionDays: num(env, 'RETENTION_DAYS', 30),
    draftTtlMinutes: num(env, 'DRAFT_TTL_MINUTES', 60),
    maxMessageChars: num(env, 'MAX_MESSAGE_CHARS', 2000),
    maxTopicChars: num(env, 'MAX_TOPIC_CHARS', 300),
    maxNameChars: num(env, 'MAX_NAME_CHARS', 40),
    dailyRewriteCap: num(env, 'DAILY_REWRITE_CAP', 2000),
    rateCreatePerHour: num(env, 'RATE_CREATE_PER_HOUR', 10),
    rateJoinPerHour: num(env, 'RATE_JOIN_PER_HOUR', 20),
    rateDraftPerMinute: num(env, 'RATE_DRAFT_PER_MINUTE', 20),
    webDir: env.WEB_DIR ?? 'dist/web',
  };
}
