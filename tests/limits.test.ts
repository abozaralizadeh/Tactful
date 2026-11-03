import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auth, draft, makeApp, pair } from './helpers.js';

const start = (t: ReturnType<typeof makeApp>) =>
  t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'Alex', topic: 'x' } });

test('starting conversations is rate limited per client', async () => {
  const t = makeApp({ config: { rateCreatePerHour: 2 } });
  assert.equal((await start(t)).statusCode, 201);
  assert.equal((await start(t)).statusCode, 201);
  const third = await start(t);
  assert.equal(third.statusCode, 429);
  assert.equal(third.json().error, 'rate_limited');
  await t.app.close();
});

test('the limit frees up after the window', async () => {
  const clock = { now: 1_000_000 };
  const t = makeApp({ config: { rateCreatePerHour: 1 }, clock });
  assert.equal((await start(t)).statusCode, 201);
  assert.equal((await start(t)).statusCode, 429);
  clock.now += 61 * 60 * 1000;
  assert.equal((await start(t)).statusCode, 201);
  await t.app.close();
});

test('rewrites are rate limited per person', async () => {
  const t = makeApp({ config: { rateDraftPerMinute: 2 } });
  const p = await pair(t);
  assert.equal((await draft(t, p.id, p.alex, 'one two three four')).status, 200);
  assert.equal((await draft(t, p.id, p.alex, 'one two three four')).status, 200);
  assert.equal((await draft(t, p.id, p.alex, 'one two three four')).status, 429);
  // Sam has their own allowance
  assert.equal((await draft(t, p.id, p.sam, 'one two three four')).status, 200);
  await t.app.close();
});

test('the daily rewrite cap stops further rewrites', async () => {
  const t = makeApp({ config: { dailyRewriteCap: 2 } });
  const p = await pair(t);
  await draft(t, p.id, p.alex, 'one two three four');
  await draft(t, p.id, p.sam, 'one two three four');
  const over = await draft(t, p.id, p.alex, 'one two three four');
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'daily_cap');
  await t.app.close();
});

test('long or odd input is refused', async () => {
  const t = makeApp({ config: { maxMessageChars: 50, maxTopicChars: 20, maxNameChars: 10 } });
  const p = await pair(t);
  assert.equal((await draft(t, p.id, p.alex, 'x'.repeat(51))).status, 400);
  assert.equal((await draft(t, p.id, p.alex, '')).status, 400);
  const longTopic = await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'Alex', topic: 'x'.repeat(21) } });
  assert.equal(longTopic.statusCode, 400);
  const longName = await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'x'.repeat(11), topic: 'x' } });
  assert.equal(longName.statusCode, 400);
  // unknown fields are dropped, not stored
  const extra = await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'A', topic: 'x', status: 'closed' } });
  assert.equal(extra.statusCode, 201);
  assert.equal(t.db.prepare("SELECT status FROM conversations WHERE id = ?").get(extra.json().id)!.status, 'waiting');
  const huge = await t.app.inject({ method: 'POST', url: `/api/conversations/${p.id}/drafts`, headers: auth(p.alex), payload: { text: 'x'.repeat(20_000) } });
  assert.equal(huge.statusCode, 413);
  await t.app.close();
});
