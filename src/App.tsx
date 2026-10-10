import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';
import { startSync } from './storage/instance.ts';
import Session from './ui/Session.tsx';
import Settings from './ui/Settings.tsx';
import Stats from './ui/Stats.tsx';
import Today from './ui/Today.tsx';

type Tab = 'today' | 'stats' | 'settings';

const TABS: Array<[Tab, string]> = [
  ['today', 'Today'],
  ['stats', 'Stats'],
  ['settings', 'Settings'],
];

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [session, setSession] = useState<{ chapter: string | null } | null>(null);

  useEffect(() => startSync(), []);

  return (
    <main className="app">
      {session ? (
        <Session chapter={session.chapter} onEnd={() => setSession(null)} />
      ) : (
        <>
          <nav className="tabs" aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} aria-current={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'today' && <Today onStart={(chapter) => setSession({ chapter })} onOpenSettings={() => setTab('settings')} />}
          {tab === 'stats' && <Stats />}
          {tab === 'settings' && <Settings />}
        </>
      )}
      <footer>
        Questions based on{' '}
        <a href="https://alisawuffles.notion.site/alisa-s-book-of-llms" target="_blank" rel="noopener noreferrer">
          Alisa's book of LLMs
        </a>
        .
      </footer>
    </main>
  );
}
