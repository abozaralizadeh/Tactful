import type { Config } from './config.js';
import type { Db } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

export interface CleanupResult {
  draftsDeleted: number;
  conversationsDeleted: number;
}

/** Drops expired drafts, then conversations past the retention period (with everything inside them). */
export function cleanup(db: Db, config: Pick<Config, 'retentionDays'>, now = Date.now()): CleanupResult {
  const cutoff = now - config.retentionDays * DAY;
  const drafts = db.prepare('DELETE FROM drafts WHERE expires_at < ?').run(now);

  const expired = `SELECT id FROM conversations
    WHERE (status = 'closed' AND closed_at < ?)
       OR (status != 'closed' AND COALESCE(last_message_at, created_at) < ?)`;
  db.prepare(`DELETE FROM rewrite_events WHERE conversation_id IN (${expired})`).run(cutoff, cutoff);
  db.prepare(`DELETE FROM usage_events WHERE conversation_id IN (${expired})`).run(cutoff, cutoff);
  const convs = db
    .prepare(`DELETE FROM conversations WHERE id IN (${expired})`)
    .run(cutoff, cutoff);

  return {
    draftsDeleted: Number(drafts.changes),
    conversationsDeleted: Number(convs.changes),
  };
}
