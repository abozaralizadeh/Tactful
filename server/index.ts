import { buildApp } from './app.js';
import { cleanup } from './cleanup.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { logStream } from './logger.js';
import { createRewriter } from './rewriter/index.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const rewriter = createRewriter(config);
const { app, limiter } = buildApp({
  config,
  db,
  rewriter,
  logStream: logStream(config.logDir, config.logMaxBytes, config.logMaxFiles),
});

const runCleanup = () => {
  const r = cleanup(db, config);
  limiter.sweep(60 * 60 * 1000);
  if (r.draftsDeleted || r.conversationsDeleted) app.log.info(r, 'cleanup');
};
runCleanup();
const timer = setInterval(runCleanup, 10 * 60 * 1000);

const stop = async () => {
  clearInterval(timer);
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.port, host: config.host });
app.log.info({ rewriter: rewriter.name, retentionDays: config.retentionDays }, 'tactful started');
