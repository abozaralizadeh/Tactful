import crypto from 'node:crypto';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import type { Hub } from './hub.js';
import type { Rewriter, RewriteResult } from './rewriter/index.js';

const DAY = 24 * 60 * 60 * 1000;

export interface Participant {
  id: string;
  conversationId: string;
  name: string;
}

export interface DraftReply {
  outcome: RewriteResult['outcome'];
  draft?: { id: string; text: string };
  reason?: string;
  showSupport?: boolean;
}

interface DraftRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  original_text: string;
  expires_at: number;
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export class Service {
  constructor(
    private db: Db,
    private config: Config,
    private rewriter: Rewriter,
    private hub: Hub,
    private clock: () => number = Date.now,
  ) {}

  // ---- who is asking ----

  authenticate(token: string | undefined): Participant {
    if (!token) throw new HttpError(401, 'unauthorized', 'This link is not valid.');
    const row = this.db
      .prepare('SELECT id, conversation_id, display_name FROM participants WHERE access_token_hash = ?')
      .get(hashToken(token)) as { id: string; conversation_id: string; display_name: string } | undefined;
    if (!row) throw new HttpError(401, 'unauthorized', 'This link is not valid.');
    this.db.prepare('UPDATE participants SET last_seen_at = ? WHERE id = ?').run(this.clock(), row.id);
    return { id: row.id, conversationId: row.conversation_id, name: row.display_name };
  }

  private ownConversation(p: Participant, id: string) {
    // Same answer for "not yours" and "doesn't exist", so ids can't be probed.
    if (p.conversationId !== id) throw new HttpError(404, 'not_found', 'Conversation not found.');
    const conv = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | { id: string; topic: string; status: string; created_at: number; last_message_at: number | null; closed_at: number | null }
      | undefined;
    if (!conv) throw new HttpError(404, 'not_found', 'Conversation not found.');
    return conv;
  }

  // ---- start and join ----

  createConversation(name: string, topic: string) {
    const id = crypto.randomUUID();
    const participantToken = newToken();
    const inviteToken = newToken();
    const now = this.clock();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO conversations (id, topic, status, invite_token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, clean(topic), 'waiting', hashToken(inviteToken), now);
      this.db
        .prepare('INSERT INTO participants (id, conversation_id, display_name, access_token_hash, consented_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), id, clean(name), hashToken(participantToken), now);
      this.count(id, 'started');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { id, participantToken, inviteToken };
  }

  getInvite(inviteToken: string) {
    const row = this.db
      .prepare(
        `SELECT c.topic, p.display_name FROM conversations c
         JOIN participants p ON p.conversation_id = c.id
         WHERE c.invite_token_hash = ? AND c.status = 'waiting'`,
      )
      .get(hashToken(inviteToken)) as { topic: string; display_name: string } | undefined;
    if (!row) throw new HttpError(404, 'invite_not_found', 'This invite is not valid any more.');
    return { topic: row.topic, inviterName: row.display_name };
  }

  join(inviteToken: string, name: string, adult: boolean, consent: boolean) {
    if (!adult) throw new HttpError(400, 'adult_required', 'You need to confirm you are 18 or over.');
    if (!consent) throw new HttpError(400, 'consent_required', 'You need to agree to the messages being rewritten.');
    const participantToken = newToken();
    const now = this.clock();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const conv = this.db
        .prepare("SELECT id FROM conversations WHERE invite_token_hash = ? AND status = 'waiting'")
        .get(hashToken(inviteToken)) as { id: string } | undefined;
      if (!conv) throw new HttpError(404, 'invite_not_found', 'This invite is not valid any more.');
      this.db
        .prepare('INSERT INTO participants (id, conversation_id, display_name, access_token_hash, consented_at) VALUES (?, ?, ?, ?, ?)')
        .run(crypto.randomUUID(), conv.id, clean(name), hashToken(participantToken), now);
      this.db
        .prepare("UPDATE conversations SET status = 'active', invite_token_hash = NULL WHERE id = ?")
        .run(conv.id);
      this.count(conv.id, 'joined');
      this.db.exec('COMMIT');
      this.hub.emit(conv.id, 'joined');
      return { id: conv.id, participantToken };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  newInvite(p: Participant, conversationId: string) {
    const conv = this.ownConversation(p, conversationId);
    if (conv.status !== 'waiting') throw new HttpError(409, 'not_waiting', 'The other person has already joined.');
    const inviteToken = newToken();
    this.db.prepare('UPDATE conversations SET invite_token_hash = ? WHERE id = ?').run(hashToken(inviteToken), conv.id);
    return { inviteToken };
  }

  // ---- reading ----

  view(p: Participant, conversationId: string) {
    const conv = this.ownConversation(p, conversationId);
    const other = this.db
      .prepare('SELECT display_name FROM participants WHERE conversation_id = ? AND id != ?')
      .get(conv.id, p.id) as { display_name: string } | undefined;
    const messages = this.db
      .prepare(
        `SELECT m.id, m.sender_id, p.display_name, m.approved_text, m.sent_at FROM messages m
         JOIN participants p ON p.id = m.sender_id
         WHERE m.conversation_id = ? ORDER BY m.sent_at, m.rowid`,
      )
      .all(conv.id) as { id: string; sender_id: string; display_name: string; approved_text: string; sent_at: number }[];
    const base = conv.status === 'closed' ? conv.closed_at! : (conv.last_message_at ?? conv.created_at);
    return {
      id: conv.id,
      topic: conv.topic,
      status: conv.status,
      deleteAt: base + this.config.retentionDays * DAY,
      me: { id: p.id, name: p.name },
      other: other ? { name: other.display_name } : null,
      messages: messages.map((m) => ({
        id: m.id,
        mine: m.sender_id === p.id,
        senderName: m.display_name,
        text: m.approved_text,
        sentAt: m.sent_at,
      })),
    };
  }

  // ---- the rewrite ----

  private async runRewrite(p: Participant, topic: string, original: string): Promise<RewriteResult> {
    const dayStart = this.clock() - (this.clock() % DAY);
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM rewrite_events WHERE created_at >= ?').get(dayStart) as { n: number };
    if (used.n >= this.config.dailyRewriteCap) {
      throw new HttpError(429, 'daily_cap', 'The service is very busy today. Please try again tomorrow.');
    }

    const recent = (
      this.db
        .prepare('SELECT sender_id, approved_text FROM messages WHERE conversation_id = ? ORDER BY sent_at DESC, rowid DESC LIMIT 6')
        .all(p.conversationId) as { sender_id: string; approved_text: string }[]
    )
      .reverse()
      .map((m) => ({ who: (m.sender_id === p.id ? 'sender' : 'other') as 'sender' | 'other', text: m.approved_text }));

    const started = this.clock();
    let result: RewriteResult;
    try {
      result = await this.rewriter.rewrite({ original, topic, recent });
      if (result.outcome === 'rewritten') {
        const text = result.text?.trim();
        if (!text || text.length > this.config.maxMessageChars * 2) throw new Error('bad rewrite text');
        result = { ...result, text };
      }
    } catch {
      this.recordEvent(p.conversationId, 'error', this.clock() - started);
      // Nothing is sent when the rewrite fails. The original never goes through.
      throw new HttpError(502, 'rewrite_failed', "Couldn't rewrite that right now, so nothing was sent. Please try again.");
    }
    this.recordEvent(p.conversationId, result.outcome, this.clock() - started, result.inputTokens, result.outputTokens);
    return result;
  }

  /** Counts what people do, without any message text. */
  private count(conversationId: string, kind: string) {
    this.db.prepare('INSERT INTO usage_events (conversation_id, kind, created_at) VALUES (?, ?, ?)').run(conversationId, kind, this.clock());
  }

  private recordEvent(conversationId: string, outcome: string, ms: number, inTok?: number, outTok?: number) {
    this.db
      .prepare('INSERT INTO rewrite_events (conversation_id, outcome, latency_ms, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(conversationId, outcome, ms, inTok ?? null, outTok ?? null, this.clock());
  }

  private requireActive(conv: { status: string }) {
    if (conv.status === 'waiting') throw new HttpError(409, 'not_active', 'The other person has not joined yet.');
    if (conv.status === 'closed') throw new HttpError(409, 'closed', 'This conversation is closed.');
  }

  private reply(result: RewriteResult, draftId?: string): DraftReply {
    if (result.outcome === 'rewritten') return { outcome: 'rewritten', draft: { id: draftId!, text: result.text! } };
    return { outcome: result.outcome, reason: result.reason, showSupport: result.showSupport === true };
  }

  async createDraft(p: Participant, conversationId: string, text: string): Promise<DraftReply> {
    const conv = this.ownConversation(p, conversationId);
    this.requireActive(conv);
    const original = text.trim();
    const result = await this.runRewrite(p, conv.topic, original);
    // One open preview per person. A new one replaces the old one, so originals don't pile up.
    this.db.prepare('DELETE FROM drafts WHERE sender_id = ?').run(p.id);
    if (result.outcome !== 'rewritten') return this.reply(result);
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO drafts (id, conversation_id, sender_id, original_text, rewritten_text, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, conv.id, p.id, original, result.text!, this.clock() + this.config.draftTtlMinutes * 60_000);
    return this.reply(result, id);
  }

  private ownDraft(p: Participant, draftId: string): DraftRow {
    const row = this.db.prepare('SELECT id, conversation_id, sender_id, original_text, expires_at FROM drafts WHERE id = ?').get(draftId) as DraftRow | undefined;
    if (!row || row.sender_id !== p.id) throw new HttpError(404, 'not_found', 'That draft is gone.');
    if (row.expires_at < this.clock()) {
      this.db.prepare('DELETE FROM drafts WHERE id = ?').run(row.id);
      throw new HttpError(404, 'not_found', 'That draft expired. Write the message again.');
    }
    return row;
  }

  private topicOf(conversationId: string): string {
    return (this.db.prepare('SELECT topic FROM conversations WHERE id = ?').get(conversationId) as { topic: string }).topic;
  }

  /** Re-runs the rewrite on the given text and updates or drops the draft to match. */
  private async redo(p: Participant, draft: DraftRow, source: string): Promise<DraftReply> {
    const conv = this.ownConversation(p, draft.conversation_id);
    this.requireActive(conv);
    const result = await this.runRewrite(p, this.topicOf(draft.conversation_id), source);
    if (result.outcome !== 'rewritten') {
      this.db.prepare('DELETE FROM drafts WHERE id = ?').run(draft.id);
      return this.reply(result);
    }
    this.db
      .prepare('UPDATE drafts SET rewritten_text = ?, expires_at = ? WHERE id = ?')
      .run(result.text!, this.clock() + this.config.draftTtlMinutes * 60_000, draft.id);
    return this.reply(result, draft.id);
  }

  async retryDraft(p: Participant, draftId: string): Promise<DraftReply> {
    const draft = this.ownDraft(p, draftId);
    this.count(draft.conversation_id, 'retried');
    return this.redo(p, draft, draft.original_text);
  }

  /** An edited preview goes through the rewrite check again, so the preview box is not a way around it. */
  async editDraft(p: Participant, draftId: string, text: string): Promise<DraftReply> {
    const draft = this.ownDraft(p, draftId);
    this.count(draft.conversation_id, 'edited');
    return this.redo(p, draft, text.trim());
  }

  sendDraft(p: Participant, draftId: string) {
    const draft = this.ownDraft(p, draftId);
    const conv = this.ownConversation(p, draft.conversation_id);
    this.requireActive(conv);
    const row = this.db.prepare('SELECT rewritten_text FROM drafts WHERE id = ?').get(draftId) as { rewritten_text: string };
    const id = crypto.randomUUID();
    const now = this.clock();
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('INSERT INTO messages (id, conversation_id, sender_id, approved_text, sent_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, conv.id, p.id, row.rewritten_text, now);
      this.db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, conv.id);
      this.db.prepare('DELETE FROM drafts WHERE id = ?').run(draftId); // the original goes with it
      this.count(conv.id, 'sent');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.hub.emit(conv.id, 'message');
    return { message: { id, mine: true, senderName: p.name, text: row.rewritten_text, sentAt: now } };
  }

  cancelDraft(p: Participant, draftId: string) {
    const draft = this.ownDraft(p, draftId);
    this.db.prepare('DELETE FROM drafts WHERE id = ?').run(draft.id);
    this.count(draft.conversation_id, 'cancelled');
  }

  close(p: Participant, conversationId: string) {
    const conv = this.ownConversation(p, conversationId);
    if (conv.status === 'closed') return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare("UPDATE conversations SET status = 'closed', closed_at = ?, invite_token_hash = NULL WHERE id = ?").run(this.clock(), conv.id);
      this.db.prepare('DELETE FROM drafts WHERE conversation_id = ?').run(conv.id);
      this.count(conv.id, 'closed');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.hub.emit(conv.id, 'closed');
  }
}
