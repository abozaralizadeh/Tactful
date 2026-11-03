import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auth, draft, makeApp, pair } from './helpers.js';

async function openStream(base: string, id: string, token: string) {
  const res = await fetch(`${base}/api/conversations/${id}/events?t=${token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return {
    async waitFor(event: string, ms = 3000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (buf.includes(`event: ${event}`)) return;
        const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 200))]);
        if (chunk && !chunk.done) buf += dec.decode(chunk.value);
      }
      throw new Error(`no ${event} event, got: ${buf}`);
    },
    close: () => reader.cancel(),
  };
}

test('the other person is told live about a join, a message and a close', async () => {
  const t = makeApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(t.app.server.address() as { port: number }).port}`;

  const a = (await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Alex', topic: 'x' }) })).json()) as any;
  const alexStream = await openStream(base, a.id, a.participantToken);
  const joined = await (await fetch(`${base}/api/invites/${a.inviteToken}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Sam', adult: true, consent: true }) })).json() as any;
  await alexStream.waitFor('joined');

  const samStream = await openStream(base, a.id, joined.participantToken);
  const d = await draft(t, a.id, a.participantToken, 'one two three four');
  await t.app.inject({ method: 'POST', url: `/api/drafts/${d.body.draft.id}/send`, headers: auth(a.participantToken) });
  await samStream.waitFor('message');

  await t.app.inject({ method: 'POST', url: `/api/conversations/${a.id}/close`, headers: auth(a.participantToken) });
  await samStream.waitFor('closed');

  // a stream for someone else's conversation is refused
  const other = (await (await fetch(`${base}/api/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Eve', topic: 'y' }) })).json()) as any;
  const refused = await fetch(`${base}/api/conversations/${a.id}/events?t=${other.participantToken}`);
  assert.equal(refused.status, 404);

  await alexStream.close();
  await samStream.close();
  await t.app.close();
});
