import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type ConversationView, type DraftReply } from './api';
import { DISCLOSURE } from './pages';

interface Notice {
  kind: 'stopped' | 'clarity' | 'error';
  text: string;
  support?: boolean;
}

const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export function Chat({ id, token }: { id: string; token: string }) {
  const [data, setData] = useState<ConversationView | null>(null);
  const [fatal, setFatal] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState('');
  const [copied, setCopied] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.view(id, token));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
        setFatal('This link does not work. The conversation may have been deleted, or the link is incomplete.');
      }
    }
  }, [id, token]);

  useEffect(() => {
    load();
    const es = new EventSource(`api/conversations/${id}/events?t=${encodeURIComponent(token)}`);
    for (const ev of ['message', 'joined', 'closed']) es.addEventListener(ev, load);
    const poll = setInterval(load, 20_000); // in case the live connection drops
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [id, token, load]);

  // The invite link is only known when the chat is started. Ask for a fresh one if this device lost it.
  useEffect(() => {
    if (data?.status !== 'waiting') return;
    let stored = '';
    try {
      stored = localStorage.getItem(`tactful:invite:${id}`) ?? '';
    } catch {
      /* ignore */
    }
    if (stored) setInvite(stored);
    else api.newInvite(id, token).then((r) => setInvite(r.inviteToken)).catch(() => undefined);
  }, [data?.status, id, token]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length, preview]);

  // When the rewrite comes back, move focus to it so keyboard and screen reader users land on the choice.
  useEffect(() => {
    if (preview) previewBox.current?.focus();
  }, [preview?.id]);

  const inviteLink = invite ? `${window.location.origin}${window.location.pathname}#/join/${invite}` : '';

  function handle(r: DraftReply, keepText = true) {
    setEditing(null);
    if (r.outcome === 'rewritten' && r.draft) {
      setPreview(r.draft);
      setNotice(null);
      return;
    }
    setPreview(null);
    if (!keepText) setText('');
    setNotice({ kind: r.outcome === 'stopped' ? 'stopped' : 'clarity', text: r.reason ?? 'That could not be sent.', support: r.showSupport });
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setNotice({ kind: 'error', text: (err as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  const rewrite = () => run(async () => handle(await api.draft(id, token, text)));
  const retry = () => run(async () => handle(await api.retry(preview!.id, token)));
  const saveEdit = () => run(async () => handle(await api.edit(preview!.id, token, editing!)));
  const cancel = () =>
    run(async () => {
      await api.cancel(preview!.id, token);
      setPreview(null);
    });
  const send = () =>
    run(async () => {
      await api.send(preview!.id, token);
      setPreview(null);
      setText('');
      await load();
    });
  const closeIt = async () => {
    if (!window.confirm('Close this conversation? Nobody will be able to send more messages.')) return;
    await run(async () => {
      await api.close(id, token);
      await load();
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      /* the link is selectable in the box */
    }
  };

  if (fatal) return <section><h1>Link not valid</h1><p>{fatal}</p></section>;
  if (!data) return <section><p>Loading…</p></section>;

  const active = data.status === 'active';

  return (
    <section className="chat">
      <header>
        <div>
          <h1>{data.topic}</h1>
          <p className="sub">{data.other ? `You and ${data.other.name}` : 'Waiting for the other person'}</p>
        </div>
        {data.status !== 'closed' && <button className="link" onClick={closeIt}>Close</button>}
      </header>
      <p className="note">{DISCLOSURE}</p>

      {data.status === 'waiting' && (
        <div className="card">
          <p><strong>Send this link to the other person.</strong> It works once.</p>
          <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button onClick={copy} disabled={!inviteLink}>{copied ? 'Copied' : 'Copy link'}</button>
          <p className="note">Keep your own link (the page address you are on) safe. It is how you get back into this conversation.</p>
        </div>
      )}

      <div className="messages" aria-live="polite">
        {data.messages.map((m) => (
          <div key={m.id} className={m.mine ? 'bubble mine' : 'bubble'}>
            <span className="who">{m.mine ? 'You' : m.senderName}</span>
            <p>{m.text}</p>
            <span className="meta">rewritten · {when(m.sentAt)}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {data.status === 'closed' && (
        <p className="card">This conversation is closed. It will be deleted on {when(data.deleteAt)}.</p>
      )}

      <p className="sr-only" role="status">{busy ? 'Working on it' : ''}</p>

      {notice && (
        <div className={`card ${notice.kind}`} role="alert">
          <p>{notice.text}</p>
          {notice.support && (
            <p>If you or someone else is in danger, call your local emergency number. You can find a helpline for your country at <a href="https://findahelpline.com" target="_blank" rel="noreferrer">findahelpline.com</a>.</p>
          )}
        </div>
      )}

      {active && preview && (
        <div className="card preview" ref={previewBox} tabIndex={-1} role="group" aria-label="Rewritten message">
          <p className="label">This is what will be sent:</p>
          {editing === null ? (
            <>
              <blockquote>{preview.text}</blockquote>
              <div className="row">
                <button onClick={send} disabled={busy}>Send</button>
                <button className="secondary" onClick={() => setEditing(preview.text)} disabled={busy}>Edit</button>
                <button className="secondary" onClick={retry} disabled={busy}>Try again</button>
                <button className="link" onClick={cancel} disabled={busy}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <textarea rows={4} value={editing} maxLength={2000} onChange={(e) => setEditing(e.target.value)} aria-label="Edit the message" />
              <p className="note">Edits are checked again before you can send them.</p>
              <div className="row">
                <button onClick={saveEdit} disabled={busy || !editing.trim()}>Check my edit</button>
                <button className="link" onClick={() => setEditing(null)} disabled={busy}>Back</button>
              </div>
            </>
          )}
        </div>
      )}

      {active && !preview && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) rewrite();
          }}
        >
          <textarea rows={3} value={text} maxLength={2000} placeholder="Say it the way you would say it. It will be rewritten before it is sent." onChange={(e) => setText(e.target.value)} aria-label="Your message" />
          <button disabled={busy || !text.trim()}>{busy ? 'Rewriting…' : 'Rewrite'}</button>
        </form>
      )}
    </section>
  );
}
