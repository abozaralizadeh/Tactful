import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Rewriter } from '../server/rewriter/index.js';
import { auth, draft, makeApp, pair } from './helpers.js';

test('message text and tokens never reach the logs, including on errors', async () => {
  const t = makeApp();
  const p = await pair(t);
  const secret = 'ZEBRAMARKER the lamp costs forty dollars and you are lazy';
  const d = await draft(t, p.id, p.alex, secret);
  await t.app.inject({ method: 'PATCH', url: `/api/drafts/${d.body.draft.id}`, headers: auth(p.alex), payload: { text: 'EDITMARKER please pay the forty dollars' } });
  await t.app.inject({ method: 'POST', url: `/api/drafts/${d.body.draft.id}/send`, headers: auth(p.alex) });
  await t.app.inject({ method: 'GET', url: `/api/conversations/${p.id}?x=QUERYMARKER`, headers: auth(p.sam) });
  await t.app.inject({ method: 'POST', url: '/api/conversations', payload: { name: 'NAMEMARKER' + 'x'.repeat(100), topic: 'TOPICMARKER' } }); // rejected: name too long
  await t.app.inject({ method: 'GET', url: `/api/conversations/${p.id}/events?t=${p.sam}x` });

  const logs = t.logs();
  assert.ok(logs.length > 0, 'expected some log lines');
  for (const needle of ['ZEBRAMARKER', 'EDITMARKER', 'QUERYMARKER', 'NAMEMARKER', 'TOPICMARKER', 'lazy', 'forty dollars', p.alex, p.sam, p.inviteToken, 'Authorization', 'Bearer']) {
    assert.equal(logs.includes(needle), false, `logs contain ${needle}`);
  }
  await t.app.close();
});

test('a crashing rewriter does not leak the message into the logs', async () => {
  const boom: Rewriter = { name: 'boom', rewrite: async ({ original }) => { throw new Error(`failed on ${original}`); } };
  const t = makeApp({ rewriter: boom });
  const p = await pair(t);
  const d = await draft(t, p.id, p.alex, 'CRASHMARKER hello there');
  assert.equal(d.status, 502);
  assert.equal(JSON.stringify(d.body).includes('CRASHMARKER'), false);
  assert.equal(t.logs().includes('CRASHMARKER'), false);
  await t.app.close();
});

test('tokens are stored only as hashes', async () => {
  const t = makeApp();
  const p = await pair(t);
  const stored = JSON.stringify([t.db.prepare('SELECT * FROM participants').all(), t.db.prepare('SELECT * FROM conversations').all()]);
  assert.equal(stored.includes(p.alex), false);
  assert.equal(stored.includes(p.sam), false);
  assert.equal(stored.includes(p.inviteToken), false);
  await t.app.close();
});

test('rewrite_events holds counts only', async () => {
  const t = makeApp();
  const cols = (t.db.prepare('PRAGMA table_info(rewrite_events)').all() as { name: string }[]).map((c) => c.name).sort();
  assert.deepEqual(cols, ['conversation_id', 'created_at', 'id', 'input_tokens', 'latency_ms', 'outcome', 'output_tokens']);
  await t.app.close();
});

test('responses carry security headers and API responses are not cached', async () => {
  const t = makeApp();
  const res = await t.app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(res.headers['cache-control'], 'no-store');
  await t.app.close();
});
