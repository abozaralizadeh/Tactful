import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanup } from '../server/cleanup.js';
import { auth, draft, makeApp, pair, view } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const count = (t: ReturnType<typeof makeApp>, table: string) => (t.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;

test('a closed conversation is deleted 30 days after closing, with everything inside it', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  const p = await pair(t);
  const d = await draft(t, p.id, p.alex, 'one two three four');
  await t.app.inject({ method: 'POST', url: `/api/drafts/${d.body.draft.id}/send`, headers: auth(p.alex) });
  await t.app.inject({ method: 'POST', url: `/api/conversations/${p.id}/close`, headers: auth(p.alex) });

  clock.now += 29 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 0);
  assert.equal((await view(t, p.id, p.sam)).status, 200);

  clock.now += 2 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 1);
  for (const table of ['conversations', 'participants', 'messages', 'drafts', 'rewrite_events', 'usage_events']) assert.equal(count(t, table), 0, table);
  assert.equal((await view(t, p.id, p.sam)).status, 401);
  await t.app.close();
});

test('an active conversation is deleted 30 days after the last message', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  const p = await pair(t);
  const d = await draft(t, p.id, p.alex, 'one two three four');
  await t.app.inject({ method: 'POST', url: `/api/drafts/${d.body.draft.id}/send`, headers: auth(p.alex) });
  clock.now += 20 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 0);
  clock.now += 11 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 1);
  await t.app.close();
});

test('a conversation nobody joins is deleted after 30 days', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'Alex', topic: 'x' } });
  clock.now += 31 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 1);
  await t.app.close();
});

test('retention days is a setting', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock, config: { retentionDays: 7 } });
  await pair(t);
  clock.now += 8 * DAY;
  assert.equal(cleanup(t.db, t.config, clock.now).conversationsDeleted, 1);
  await t.app.close();
});

test('expired drafts are deleted by the cleanup job', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  const p = await pair(t);
  await draft(t, p.id, p.alex, 'one two three four');
  clock.now += 2 * 60 * 60 * 1000;
  assert.equal(cleanup(t.db, t.config, clock.now).draftsDeleted, 1);
  assert.equal(count(t, 'drafts'), 0);
  await t.app.close();
});

test('the view tells people when the conversation will be deleted', async () => {
  const clock = { now: 10 * DAY };
  const t = makeApp({ clock });
  const p = await pair(t);
  await t.app.inject({ method: 'POST', url: `/api/conversations/${p.id}/close`, headers: auth(p.alex) });
  assert.equal((await view(t, p.id, p.sam)).body.deleteAt, 40 * DAY);
  await t.app.close();
});
