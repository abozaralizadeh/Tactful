import { useEffect, useRef, useState } from 'react';
import { Chat } from './Chat';
import { Join, Landing, Privacy, Start, Terms } from './pages';

const current = () => window.location.hash.replace(/^#/, '') || '/';

// Page titles never include the topic, a name or a link.
const TITLES: Record<string, string> = {
  start: 'Start a conversation',
  join: 'Join a conversation',
  c: 'Conversation',
  privacy: 'Privacy notice',
  terms: 'Terms of use',
};

export function App() {
  const [route, setRoute] = useState(current());
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const on = () => {
      setRoute(current());
      window.scrollTo(0, 0);
      main.current?.focus(); // so a screen reader starts reading the new page
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const parts = route.split('/').filter(Boolean);
  useEffect(() => {
    document.title = `${TITLES[parts[0]] ?? 'Talk it through'} · Tactful`;
  }, [parts[0]]);
  let page;
  if (parts[0] === 'start') page = <Start />;
  else if (parts[0] === 'join' && parts[1]) page = <Join invite={parts[1]} />;
  else if (parts[0] === 'c' && parts[1] && parts[2]) page = <Chat key={parts[1]} id={parts[1]} token={parts[2]} />;
  else if (parts[0] === 'privacy') page = <Privacy />;
  else if (parts[0] === 'terms') page = <Terms />;
  else page = <Landing />;

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); main.current?.focus(); }}>Skip to the page</a>
      <main id="main" ref={main} tabIndex={-1}>{page}</main>
      <footer>
        <a href="#/">Tactful</a> · <a href="#/privacy">Privacy</a> · <a href="#/terms">Terms</a>
      </footer>
    </>
  );
}
