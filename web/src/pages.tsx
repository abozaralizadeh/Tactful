import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';

export const DISCLOSURE = 'Messages here are rewritten by AI to keep the conversation calm. The other person is told, and you approve every message before it is sent.';

function Field(props: { label: string; value: string; onChange: (v: string) => void; max: number; multiline?: boolean; hint?: string }) {
  const common = { value: props.value, maxLength: props.max, required: true, onChange: (e: { target: { value: string } }) => props.onChange(e.target.value) };
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function Landing() {
  return (
    <section>
      <h1>Talk it through, calmly.</h1>
      <p>
        Tactful is a chat for two people who have a problem to solve. You write what you want to say. The other person gets a calmer, more tactful version of it, so you can talk without anger.
      </p>
      <ol className="steps">
        <li>You start a chat and send the other person a link.</li>
        <li>You write a message, in your own words.</li>
        <li>AI rewrites it. You check it, and send it if it still says what you mean.</li>
        <li>The other person only ever sees the rewritten version, marked as rewritten.</li>
      </ol>
      <p className="note">For adults with everyday disagreements: money, housing, family, work. It is not therapy, legal advice or mediation, and it is not for situations involving abuse or violence.</p>
      <a className="button" href="#/start">Start a conversation</a>
    </section>
  );
}

export function Start() {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.start(name.trim(), topic.trim());
      try {
        localStorage.setItem(`tactful:invite:${r.id}`, r.inviteToken);
      } catch {
        /* private mode: the chat page can ask for a fresh invite */
      }
      window.location.hash = `#/c/${r.id}/${r.participantToken}`;
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Start a conversation</h1>
      <form onSubmit={submit}>
        <Field label="Your name" value={name} onChange={setName} max={40} hint="The other person will see this." />
        <Field label="What do you need to sort out?" value={topic} onChange={setTopic} max={300} multiline hint="One or two lines. The other person sees this before they join." />
        <p className="note">{DISCLOSURE}</p>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy}>{busy ? 'Starting…' : 'Start and get the invite link'}</button>
      </form>
    </section>
  );
}

export function Join({ invite }: { invite: string }) {
  const [info, setInfo] = useState<{ topic: string; inviterName: string } | null>(null);
  const [gone, setGone] = useState(false);
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invite(invite).then(setInfo).catch(() => setGone(true));
  }, [invite]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.join(invite, name.trim());
      window.location.hash = `#/c/${r.id}/${r.participantToken}`;
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }

  if (gone) {
    return (
      <section>
        <h1>This invite does not work any more</h1>
        <p>It may have been used already, or the conversation was closed. Ask for a new link.</p>
      </section>
    );
  }
  if (!info) return <section><p>Loading…</p></section>;

  return (
    <section>
      <h1>{info.inviterName} invited you to talk something through</h1>
      <blockquote>{info.topic}</blockquote>
      <p>{DISCLOSURE}</p>
      <form onSubmit={submit}>
        <Field label="Your name" value={name} onChange={setName} max={40} hint="The other person will see this." />
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
          <span>I am 18 or over.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <span>
            I understand my messages are rewritten by AI before the other person sees them, and I agree to the <a href="#/terms" target="_blank" rel="noreferrer">terms</a> and <a href="#/privacy" target="_blank" rel="noreferrer">privacy notice</a>.
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy || !adult || !consent}>{busy ? 'Joining…' : 'Join the conversation'}</button>
      </form>
    </section>
  );
}

const Draft = () => (
  <p className="draft-banner">Template text. Fill in the details in [square brackets] and have it reviewed before real use.</p>
);

export function Privacy() {
  return (
    <section className="legal">
      <h1>Privacy notice</h1>
      <Draft />
      <p>Who runs this: [name of the service provider and contact address].</p>
      <h2>What we keep</h2>
      <ul>
        <li>The names you choose, and the topic you write.</li>
        <li>The messages that were approved and sent, as the rewritten text the other person saw.</li>
        <li>A short time while you are previewing: your original text, so you can ask for another version. It is deleted as soon as you send or cancel, and after {`1 hour`} at the latest.</li>
        <li>Counts for running the service: how many rewrites, how long they took, and whether they were accepted. These never contain message text.</li>
        <li>Your access link is stored only as a one way hash. We do not use accounts, passwords or tracking cookies.</li>
      </ul>
      <h2>Who sees your messages</h2>
      <p>Your text is sent to an AI provider ([provider name], [country or region]) to be rewritten. Under our agreement with them it is not used to train models, and [retention terms]. Our hosting provider ([provider name], [region]) stores the data.</p>
      <p>We cannot offer end to end encryption, because our server has to read a message to have it rewritten. Connections are encrypted in transit.</p>
      <h2>How long</h2>
      <p>A conversation is deleted 30 days after it is closed, or 30 days after the last message if nobody closes it. Either person can close it at any time.</p>
      <h2>Your rights</h2>
      <p>You can ask to see or delete your data at [contact address]. Please include your access link so we can find the conversation. [Legal basis, complaint rights and anything else that applies where you run it.]</p>
    </section>
  );
}

export function Terms() {
  return (
    <section className="legal">
      <h1>Terms of use</h1>
      <Draft />
      <ul>
        <li>You must be 18 or over.</li>
        <li>Tactful is for everyday disagreements. It is not therapy, legal advice or formal mediation, and it is not for situations involving abuse, violence or danger. If you or someone else is in danger, contact your local emergency number.</li>
        <li>Messages are rewritten by AI. The AI can get things wrong, so read every rewrite before you send it. You are responsible for what you approve.</li>
        <li>Do not use the service to threaten, harass or pressure anyone, or to look calm while manipulating someone. Threats are not sent.</li>
        <li>We may block use that looks like abuse, and limit how much any one person can use.</li>
        <li>The service is provided as it is, without promises that it is always available. [Liability wording.]</li>
        <li>[Provider name, governing law and contact address.]</li>
      </ul>
    </section>
  );
}
