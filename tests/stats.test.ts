import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup } from '../server/cleanup.js';
import { collectStats, formatStats } from '../server/stats.js';
import { auth, draft, makeApp, pair } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const post = (t: ReturnType<typeof makeApp>, url: string, token: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers: auth(token), payload });

test('what people do is counted, and the counts hold no message text', async () => {
  const t = makeApp();
  const p = await pair(t);
  const first = await draft(t, p.id, p.alex, 'You never listen, this is ridiculous. Call me by Friday.');
  await post(t, `/api/drafts/${first.body.draft.id}/retry`, p.alex);
  await t.app.inject({ method: 'PATCH', url: `/api/drafts/${first.body.draft.id}`, headers: auth(p.alex), payload: { text: 'Please call me by Friday.' } });
  await post(t, `/api/drafts/${first.body.draft.id}/send`, p.alex);
  const second = await draft(t, p.id, p.sam, 'I will call on Thursday evening.');
  await t.app.inject({ method: 'DELETE', url: `/api/drafts/${second.body.draft.id}`, headers: auth(p.sam) });
  await post(t, `/api/conversations/${p.id}/close`, p.sam);

  const s = collectStats(t.db);
  assert.deepEqual(s.usage, { started: 1, joined: 1, retried: 1, edited: 1, sent: 1, cancelled: 1, closed: 1 });
  assert.equal(s.conversations.closed, 1);
  assert.equal(s.rewrites.outcomes.rewritten, 4);

  const everything = JSON.stringify(t.db.prepare('SELECT * FROM usage_events').all()) + formatStats(s);
  assert.ok(!/Friday|listen|ridiculous|Thursday/.test(everything));
  await t.app.close();
});

test('the counts go when the conversation is deleted', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  const p = await pair(t);
  await post(t, `/api/conversations/${p.id}/close`, p.alex);
  clock.now += 31 * DAY;
  cleanup(t.db, t.config, clock.now);
  assert.deepEqual(collectStats(t.db).usage, {});
  await t.app.close();
});

test('stats on an empty database say none yet', () => {
  const t = makeApp();
  assert.match(formatStats(collectStats(t.db)), /Conversations: none yet/);
});
