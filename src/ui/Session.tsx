import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bank } from '../bank/index.ts';
import { sectionLink, sectionLinkLabel, DEFAULT_TOLERANCE, type Question } from '../bank/types.ts';
import { formatNumber, isCloseEnough, parseNumeric } from '../grading/numeric.ts';
import { buildQueue, queueCounts, type QueueItem } from '../srs/queue.ts';
import { autoRating, RATING_LABELS, type Rating } from '../srs/rating.ts';
import type { CardState } from '../srs/scheduler.ts';
import { seededOrder } from '../srs/shuffle.ts';
import { sync } from '../storage/instance.ts';
import Markdown from './Markdown.tsx';
import SyncChip from './SyncChip.tsx';
import { statesFor, useProgress } from './useProgress.ts';

const KIND_LABEL: Record<Question['kind'], string> = {
  numeric: 'NUMBER',
  recall: 'WHY',
  mcq: 'CHOICE',
  truefalse: 'TRAP',
};

const MAX_ANSWER_CHARS = 200;
const KEY_COOLDOWN_MS = 150;

type Phase =
  | { step: 'asking' }
  | {
      step: 'answered';
      /** null for recall (self-graded). */
      correct: boolean | null;
      /** What was typed or picked, for the record and for the feedback. */
      answer: string;
      ms: number;
      /** mcq: displayed index picked. */
      picked?: number;
    };

interface GradeInput {
  r: Rating;
  ms: number;
  a: string;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

function nextItem(chapter: string | null, justAnswered: string | null): QueueItem | null {
  const snap = sync.getSnapshot();
  return buildQueue(Date.now(), statesFor(snap.file), bank, snap.file.settings, { chapter, justAnswered });
}

export default function Session({ chapter, onEnd }: { chapter: string | null; onEnd: () => void }) {
  const { states, status } = useProgress();
  const [current, setCurrent] = useState<QueueItem | null>(() => nextItem(chapter, null));
  const [answered, setAnswered] = useState(0);

  const counts = useMemo(() => queueCounts(Date.now(), states, bank, chapter), [states, chapter]);

  const onGrade = useCallback(
    (item: QueueItem, g: GradeInput) => {
      void sync.addEvent({
        c: item.concept.id,
        v: item.variantIndex,
        t: Date.now(),
        r: g.r,
        ms: g.ms,
        ...(g.a ? { a: g.a.slice(0, MAX_ANSWER_CHARS) } : {}),
      });
      setAnswered((n) => n + 1);
      setCurrent(nextItem(chapter, item.concept.id));
    },
    [chapter],
  );

  const onFlag = useCallback((conceptId: string): boolean => {
    const note = window.prompt('What is wrong or ambiguous about this question?');
    if (!note || !note.trim()) return false;
    void sync.addEvent({ c: conceptId, t: Date.now(), flag: note.trim().slice(0, 500) });
    return true;
  }, []);

  return (
    <section className="screen session">
      <div className="session-bar">
        <span className="progress-line">
          {answered} answered · {counts.learningDue + counts.reviewDue} due · {counts.newRemaining} new
        </span>
        <SyncChip status={status} />
        <button type="button" className="btn small-btn" onClick={onEnd}>
          End session
        </button>
      </div>
      {current ? (
        <Card
          key={`${current.concept.id}:${states.get(current.concept.id)?.reviews ?? 0}:${answered}`}
          item={current}
          state={states.get(current.concept.id)}
          onGrade={onGrade}
          onFlag={onFlag}
        />
      ) : (
        <p className="notice">No questions to practice{chapter ? ' in this chapter' : ''}.</p>
      )}
    </section>
  );
}

function Card({
  item,
  state,
  onGrade,
  onFlag,
}: {
  item: QueueItem;
  state: CardState | undefined;
  onGrade: (item: QueueItem, g: GradeInput) => void;
  onFlag: (conceptId: string) => boolean;
}) {
  const { concept, variantIndex } = item;
  const q = concept.variants[variantIndex] ?? (concept.variants[0] as Question);
  const shownAt = useRef(Date.now());
  const phaseAt = useRef(0);
  const [phase, setPhaseRaw] = useState<Phase>({ step: 'asking' });
  const [flagged, setFlagged] = useState(false);
  const [typed, setTyped] = useState('');
  const [badInput, setBadInput] = useState(false);

  const setPhase = (p: Phase) => {
    phaseAt.current = Date.now();
    setPhaseRaw(p);
  };

  // Deterministic per review: same card + same review count = same order.
  const order = useMemo(
    () => (q.kind === 'mcq' ? seededOrder(q.choices.length, `${concept.id}:${state?.reviews ?? 0}`) : []),
    [q, concept.id, state?.reviews],
  );

  const section = bank.sections.get(concept.section);
  const chapterName = bank.chapterOf.get(concept.id) ?? '';

  const elapsed = () => Date.now() - shownAt.current;

  const checkNumber = () => {
    if (q.kind !== 'numeric') return;
    // When the answer is already expressed in percent, "27%" means 27, not 0.27.
    const x = parseNumeric(q.unit === '%' ? typed.replace(/%\s*$/, '') : typed);
    if (x === null) {
      setBadInput(true);
      return;
    }
    setBadInput(false);
    setPhase({ step: 'answered', correct: isCloseEnough(x, q.answer, q.tolerance ?? DEFAULT_TOLERANCE), answer: typed.trim(), ms: elapsed() });
  };

  const reveal = () => {
    if (q.kind !== 'recall') return;
    setPhase({ step: 'answered', correct: null, answer: typed.trim(), ms: elapsed() });
  };

  const pickChoice = (display: number) => {
    if (q.kind !== 'mcq' || phase.step !== 'asking') return;
    const original = order[display];
    if (original === undefined) return;
    setPhase({
      step: 'answered',
      correct: original === q.correct,
      answer: q.choices[original] ?? '',
      ms: elapsed(),
      picked: display,
    });
  };

  const pickBool = (value: boolean) => {
    if (q.kind !== 'truefalse' || phase.step !== 'asking') return;
    setPhase({ step: 'answered', correct: value === q.answer, answer: value ? 'True' : 'False', ms: elapsed() });
  };

  const grade = (r: Rating) => {
    if (phase.step !== 'answered') return;
    onGrade(item, { r, ms: phase.ms, a: phase.answer });
  };

  const flag = () => {
    if (onFlag(concept.id)) setFlagged(true);
  };

  // Keyboard shortcuts. A ref keeps the listener current without re-subscribing on every render.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (Date.now() - phaseAt.current < KEY_COOLDOWN_MS) return;
    const key = e.key.toLowerCase();
    const act = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    const confirm = key === ' ' || key === 'enter';

    if (phase.step === 'asking') {
      if (key === 'f' && q.kind !== 'truefalse') return act(flag);
      switch (q.kind) {
        case 'numeric':
          return; // typing happens in the focused input
        case 'recall':
          if (confirm) act(reveal);
          return;
        case 'mcq':
          if (key >= '1' && key <= '4') act(() => pickChoice(Number(key) - 1));
          return;
        case 'truefalse':
          if (key === 't') act(() => pickBool(true));
          else if (key === 'f') act(() => pickBool(false));
          return;
      }
    }

    // answered
    if (key === 'f') return act(flag);
    if (q.kind === 'recall') {
      if (key >= '1' && key <= '4') act(() => grade(Number(key) as Rating));
      return;
    }
    if (phase.correct) {
      if (key === '2') act(() => grade(autoRating(true, 'guessed')));
      else if (key === '3' || confirm) act(() => grade(autoRating(true, 'knew')));
      else if (key === '4') act(() => grade(autoRating(true, 'easy')));
    } else if (key === '1' || confirm) {
      act(() => grade(1));
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const answered = phase.step === 'answered';

  return (
    <article className="card">
      <header className="card-head">
        <span className="crumb">
          {chapterName}
          {section && section.title !== chapterName ? ` › ${section.title}` : ''}
        </span>
        <span className={`badge badge-${q.kind}`}>{KIND_LABEL[q.kind]}</span>
      </header>

      <Markdown text={q.prompt} className="prompt" />

      {/* ---- asking ---- */}
      {!answered && q.kind === 'numeric' && (
        <form
          className="answer-form"
          onSubmit={(e) => {
            e.preventDefault();
            checkNumber();
          }}
        >
          <input
            className="input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            placeholder={q.unit ? `Your answer (${q.unit})` : 'Your answer'}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setBadInput(false);
            }}
            aria-label="Your answer"
          />
          {badInput && <p className="warn small">That does not look like a number. Try 18, 1.5e9, 1.5B, 3k or 2^30.</p>}
          <button type="submit" className="btn primary big">
            Check
          </button>
        </form>
      )}

      {!answered && q.kind === 'recall' && (
        <div className="answer-form">
          <textarea
            className="input"
            rows={3}
            placeholder="Type your answer (optional)"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                reveal();
              }
            }}
            aria-label="Type your answer (optional)"
          />
          <button type="button" className="btn primary big" onClick={reveal}>
            Reveal
          </button>
        </div>
      )}

      {q.kind === 'mcq' && (
        <ol className="choices">
          {order.map((orig, display) => {
            const isCorrect = orig === q.correct;
            const isPicked = phase.step === 'answered' && phase.picked === display;
            const cls = answered ? (isCorrect ? 'right' : isPicked ? 'wrong' : 'dim') : '';
            return (
              <li key={orig}>
                <button type="button" className={`choice ${cls}`} disabled={answered} onClick={() => pickChoice(display)}>
                  <span className="choice-key">{display + 1}</span>
                  <Markdown text={q.choices[orig] ?? ''} inline />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {q.kind === 'truefalse' && (
        <div className="tf">
          {[true, false].map((v) => {
            const isPicked = phase.step === 'answered' && phase.answer === (v ? 'True' : 'False');
            const cls = answered ? (v === q.answer ? 'right' : isPicked ? 'wrong' : 'dim') : '';
            return (
              <button key={String(v)} type="button" className={`choice ${cls}`} disabled={answered} onClick={() => pickBool(v)}>
                <span className="choice-key">{v ? 'T' : 'F'}</span>
                {v ? 'True' : 'False'}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- feedback ---- */}
      {phase.step === 'answered' && (
        <div className="feedback" role="status">
          {q.kind === 'numeric' && (
            <>
              <p className={phase.correct ? 'ok verdict' : 'warn verdict'}>{phase.correct ? 'Correct' : 'Not quite'}</p>
              <p>
                Expected: <b>{formatNumber(q.answer)}</b>
                {q.unit ? ` ${q.unit}` : ''}
                <span className="muted small">
                  {' '}
                  ({(q.tolerance ?? DEFAULT_TOLERANCE) === 0 ? 'exact' : `±${Math.round((q.tolerance ?? DEFAULT_TOLERANCE) * 1000) / 10}%`})
                </span>
              </p>
              <p className="muted">
                You typed: <span className="typed">{phase.answer}</span>
              </p>
            </>
          )}
          {q.kind === 'recall' && (
            <>
              {phase.answer && (
                <p className="muted">
                  You wrote: <span className="typed">{phase.answer}</span>
                </p>
              )}
              <div className="model-answer">
                <span className="label">Model answer</span>
                <Markdown text={q.answer} />
              </div>
            </>
          )}
          {(q.kind === 'mcq' || q.kind === 'truefalse') && (
            <p className={phase.correct ? 'ok verdict' : 'warn verdict'}>
              {phase.correct ? 'Correct' : q.kind === 'truefalse' ? `Wrong: the answer is ${q.answer ? 'True' : 'False'}` : 'Not quite'}
            </p>
          )}
          {q.explanation && <Markdown text={q.explanation} className="explanation" />}
          <div className="row links">
            <a href={sectionLink(concept.section, section)} target="_blank" rel="noopener noreferrer">
              {sectionLinkLabel(section)}
            </a>
            <button type="button" className="btn small-btn" onClick={flag} disabled={flagged}>
              {flagged ? 'Flagged' : 'Flag (F)'}
            </button>
          </div>
        </div>
      )}

      {/* ---- grading ---- */}
      {phase.step === 'answered' && q.kind === 'recall' && (
        <div className="grades four">
          {([1, 2, 3, 4] as Rating[]).map((r) => (
            <button key={r} type="button" className={`btn grade g${r}`} onClick={() => grade(r)}>
              <kbd>{r}</kbd> {RATING_LABELS[r]}
            </button>
          ))}
        </div>
      )}
      {phase.step === 'answered' && q.kind !== 'recall' && phase.correct && (
        <div className="grades three">
          <button type="button" className="btn grade g2" onClick={() => grade(autoRating(true, 'guessed'))}>
            <kbd>2</kbd> Guessed
          </button>
          <button type="button" className="btn grade g3" onClick={() => grade(autoRating(true, 'knew'))}>
            <kbd>3</kbd> Knew it
          </button>
          <button type="button" className="btn grade g4" onClick={() => grade(autoRating(true, 'easy'))}>
            <kbd>4</kbd> Easy
          </button>
        </div>
      )}
      {phase.step === 'answered' && q.kind !== 'recall' && !phase.correct && (
        <div className="grades one">
          <button type="button" className="btn grade g1" onClick={() => grade(1)}>
            <kbd>1</kbd> Continue
          </button>
        </div>
      )}
    </article>
  );
}
