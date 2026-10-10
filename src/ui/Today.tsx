import { useMemo, useState } from 'react';
import { bank, usingSampleBank } from '../bank/index.ts';
import { queueCounts } from '../srs/queue.ts';
import { firstReviewTime, windowInfo, WINDOW_DAYS } from '../srs/window.ts';
import { sync } from '../storage/instance.ts';
import SyncChip from './SyncChip.tsx';
import { useProgress } from './useProgress.ts';

export default function Today({ onStart, onOpenSettings }: { onStart: (chapter: string | null) => void; onOpenSettings: () => void }) {
  const { file, states, status, ready } = useProgress();
  const [chapter, setChapter] = useState<string>('');
  const scope = chapter || null;

  const now = Date.now();
  const counts = useMemo(() => queueCounts(now, states, bank, scope), [now, states, scope]);
  const win = useMemo(
    () =>
      windowInfo({
        now,
        firstReview: firstReviewTime(file.events),
        states: scope ? new Map([...states].filter(([id]) => bank.chapterOf.get(id) === scope)) : states,
        total: counts.total,
        remainingNew: counts.newRemaining,
      }),
    [now, file.events, states, scope, counts],
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
            <span>Focus</span>
            <select value={chapter} onChange={(e) => setChapter(e.target.value)}>
              <option value="">All chapters</option>
              {bank.chapters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn primary big" onClick={() => onStart(scope)}>
            Start
          </button>
        </>
      )}
    </section>
  );
}
