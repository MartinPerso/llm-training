import { useMemo } from 'react';
import { bank, usingSampleBank } from '../bank/index.ts';
import { BOOK_TITLE } from '../bank/types.ts';
import { queueCounts, scopeIds, type PracticeScope } from '../srs/queue.ts';
import { firstReviewTime, windowInfo, WINDOW_DAYS } from '../srs/window.ts';
import { sync } from '../storage/instance.ts';
import SyncChip from './SyncChip.tsx';
import { useProgress } from './useProgress.ts';

const SOURCE_LABELS: Record<string, string> = {
  [BOOK_TITLE]: 'LLM',
  'RL & agentic RL interview notes': 'Post-training & RL',
  'Quant research': 'Quant',
};

export default function Today({ scope, onScopeChange, onStart, onOpenSettings }: {
  scope: PracticeScope;
  onScopeChange: (scope: PracticeScope) => void;
  onStart: () => void;
  onOpenSettings: () => void;
}) {
  const { file, states, status, ready } = useProgress();
  const groups = bank.chapterGroups.filter((g) => !scope.source || g.source === scope.source);
  const scopedStates = useMemo(() => {
    const ids = new Set(scopeIds(bank, scope));
    return new Map([...states].filter(([id]) => ids.has(id)));
  }, [states, scope]);

  const now = Date.now();
  const counts = useMemo(() => queueCounts(now, states, bank, scope), [now, states, scope]);
  const win = useMemo(
    () =>
      windowInfo({
        now,
        firstReview: firstReviewTime(file.events),
        states: scopedStates,
        total: counts.total,
        remainingNew: counts.newRemaining,
      }),
    [now, file.events, scopedStates, counts],
  );

  const empty = bank.concepts.length === 0;

  let dayText: string;
  if (win.phase === 'not-started') dayText = "Start whenever you're ready: the 10 days begin with your first answer.";
  else if (win.phase === 'finished') dayText = `The ${WINDOW_DAYS}-day window is over (day ${win.day}). You can keep practicing.`;
  else dayText = `Day ${win.day} of ${WINDOW_DAYS}`;

  let paceText: string | null = null;
  if (win.phase !== 'finished' && counts.newRemaining > 0) {
    if (win.introduceAll) paceText = `Introduce all remaining ${counts.newRemaining} new concepts now: the introduction phase (day 6) is over.`;
    else if (win.leftToday > 0) paceText = `Introduce ~${win.leftToday} new today to be done by day 6.`;
    else paceText = 'Today\'s pace goal for new concepts is reached.';
  } else if (counts.newRemaining === 0 && !empty) {
    paceText = 'Every concept has been introduced.';
  }

  return (
    <section className="screen">
      <div className="row between">
        <h1>Today</h1>
        <SyncChip status={status} onClick={() => (status.state === 'local-only' ? onOpenSettings() : void sync.syncNow())} />
      </div>
      {usingSampleBank && <p className="notice">Dev mode: showing the sample bank (the real bank is empty).</p>}
      {empty ? (
        <p className="notice">The question bank is empty. Add chapters under content/questions/.</p>
      ) : !ready ? (
        <p className="muted">Loading your progress…</p>
      ) : (
        <>
          <p className="day">{dayText}</p>
          <div className="stats-grid">
            <div className="stat">
              <b>{counts.learningDue + counts.reviewDue}</b>
              <span>due now</span>
            </div>
            <div className="stat">
              <b>{counts.learning}</b>
              <span>learning</span>
            </div>
            <div className="stat">
              <b>{counts.newRemaining}</b>
              <span>new left</span>
            </div>
          </div>
          {paceText && (
            <p className="pace">
              {paceText}{' '}
              {win.phase === 'running' && counts.newRemaining > 0 && (
                <span className={win.onTrack ? 'ok' : 'warn'}>{win.onTrack ? 'On track.' : 'Behind: catch up when you can.'}</span>
              )}
            </p>
          )}
          <label className="field">
            <span>Section</span>
            <select value={scope.source ?? ''} onChange={(e) => onScopeChange({ source: e.target.value || null, chapter: null })}>
              <option value="">All sections</option>
              {bank.chapterGroups.map((g) => (
                <option key={g.source} value={g.source}>
                  {SOURCE_LABELS[g.source] ?? g.source}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Chapter (optional)</span>
            <select value={scope.chapter ?? ''} onChange={(e) => onScopeChange({ ...scope, chapter: e.target.value || null })}>
              <option value="">All chapters</option>
              {groups.map((g) => (
                <optgroup key={g.source} label={g.source}>
                  {g.chapters.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <p className="muted small">{counts.total} concepts in the selected {scope.chapter ? 'chapter' : scope.source ? 'section' : 'bank'}.</p>
          <button type="button" className="btn primary big" onClick={onStart}>
            Start
          </button>
        </>
      )}
    </section>
  );
}
