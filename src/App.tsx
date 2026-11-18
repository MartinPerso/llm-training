import { useEffect, useState } from 'react';
import 'katex/dist/katex.min.css';
import type { PracticeScope } from './srs/queue.ts';
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
  const [scope, setScope] = useState<PracticeScope>({});
  const [session, setSession] = useState<PracticeScope | null>(null);

  useEffect(() => startSync(), []);

  return (
    <main className="app">
      {session ? (
        <Session scope={session} onEnd={() => setSession(null)} />
      ) : (
        <>
          <nav className="tabs" aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'tab active' : 'tab'} aria-current={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'today' && (
            <Today scope={scope} onScopeChange={setScope} onStart={() => setSession(scope)} onOpenSettings={() => setTab('settings')} />
          )}
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
