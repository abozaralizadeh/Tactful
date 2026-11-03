import { Writable } from 'node:stream';
import { buildApp } from '../server/app.js';
import { loadConfig, type Config } from '../server/config.js';
import { openDb } from '../server/db.js';
import { FakeRewriter } from '../server/rewriter/fake.js';
import type { Rewriter } from '../server/rewriter/index.js';

export function makeApp(opts: { config?: Partial<Config>; rewriter?: Rewriter; clock?: { now: number } } = {}) {
  const config = { ...loadConfig({}), webDir: 'does-not-exist', ...opts.config };
  const db = openDb(':memory:');
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _e, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const clock = opts.clock;
  const built = buildApp({
    config,
    db,
    rewriter: opts.rewriter ?? new FakeRewriter(),
    logStream,
    clock: clock ? () => clock.now : undefined,
  });
  return { ...built, db, config, logs: () => logs.join('') };
}

type Built = ReturnType<typeof makeApp>;

export const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Starts a conversation as Alex, and has Sam join. */
export async function pair(t: Built) {
  const start = await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'Alex', topic: 'Who pays for the broken lamp' } });
  const a = start.json() as { id: string; participantToken: string; inviteToken: string };
  const join = await t.app.inject({ method: 'POST', url: `/api/invites/${a.inviteToken}/join`, payload: { name: 'Sam', adult: true, consent: true } });
  const s = join.json() as { id: string; participantToken: string };
  return { id: a.id, alex: a.participantToken, sam: s.participantToken, inviteToken: a.inviteToken };
}

export async function draft(t: Built, id: string, token: string, text: string) {
  const res = await t.app.inject({ method: 'POST', url: `/api/conversations/${id}/drafts`, headers: auth(token), payload: { text } });
  return { status: res.statusCode, body: res.json() as any };
}

export async function view(t: Built, id: string, token: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/conversations/${id}`, headers: auth(token) });
  return { status: res.statusCode, body: res.json() as any };
}
