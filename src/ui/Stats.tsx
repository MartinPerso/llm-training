import { useMemo } from 'react';
import { bank } from '../bank/index.ts';
import { sectionLink, sectionLinkLabel } from '../bank/types.ts';
import { chapterStats, mostMissed } from '../srs/stats.ts';
import Markdown from './Markdown.tsx';
import { useProgress } from './useProgress.ts';

export default function Stats() {
  const { file, states } = useProgress();
  const now = Date.now();
  const chapters = useMemo(() => chapterStats(now, file.events, states, bank), [now, file.events, states]);
  const missed = useMemo(() => mostMissed(states, 10), [states]);

  return (
    <section className="screen">
      <h1>Stats</h1>
      <h2>Chapters</h2>
      {chapters.length === 0 && <p className="muted">No questions loaded.</p>}
      <ul className="list">
        {chapters.map((c) => (
          <li key={c.chapter}>
            <div className="row between">
              <span>{c.chapter}</span>
              <span className="muted">
                {c.seen}/{c.total} seen
              </span>
            </div>
            <div className="bar" aria-hidden="true">
              <i style={{ width: `${c.total ? (100 * c.seen) / c.total : 0}%` }} />
            </div>
            <div className="muted small">
              {c.recall === null
                ? 'no reviews in the last 3 days'
                : `recall, last 3 days: ${Math.round(c.recall * 100)}% of ${c.recentReviews} answers`}
            </div>
          </li>
        ))}
      </ul>

      <h2>Most missed</h2>
      {missed.length === 0 && <p className="muted">Nothing missed yet.</p>}
      <ol className="list">
        {missed.map((m) => {
          const concept = bank.byId.get(m.id);
          if (!concept) return null;
          const first = concept.variants[0];
          const section = bank.sections.get(concept.section);
          return (
            <li key={m.id}>
              <div className="row between">
                <span className="small muted">{bank.chapterOf.get(m.id)}</span>
                <span className="small warn">
                  missed {m.misses}× in {m.reviews}
                </span>
              </div>
              {first && <Markdown text={first.prompt} />}
              <a href={sectionLink(concept.section, section)} target="_blank" rel="noopener noreferrer">
                {sectionLinkLabel(section)}
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
