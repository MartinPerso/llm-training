import { describe, expect, it } from 'vitest';
import { review } from '../test/helpers.ts';
import type { CardState } from './scheduler.ts';
import { dayNumber, firstReviewTime, paceHint, windowInfo, WINDOW_DAYS } from './window.ts';

const local = (d: number, h = 12) => new Date(2026, 2, d, h, 0, 0).getTime(); // March 2026, local time

const stateFirstSeen = (t: number) => ({ firstSeen: t }) as CardState;

describe('dayNumber', () => {
  it('counts local calendar days from the first answer (day 1 = that day)', () => {
    expect(dayNumber(local(5, 23), local(5, 8))).toBe(1);
    expect(dayNumber(local(6, 0), local(5, 23))).toBe(2);
    expect(dayNumber(local(14, 12), local(5, 8))).toBe(10);
    expect(dayNumber(local(15, 12), local(5, 8))).toBe(11);
  });
  it('survives month boundaries', () => {
    expect(dayNumber(new Date(2026, 3, 2, 9).getTime(), new Date(2026, 2, 30, 22).getTime())).toBe(4);
  });
});

describe('firstReviewTime', () => {
  it('is the earliest review, ignoring flags; null before any answer', () => {
    expect(firstReviewTime([])).toBeNull();
    expect(firstReviewTime([{ c: 'x', t: 1, flag: 'f' }])).toBeNull();
    expect(firstReviewTime([review('a', 50), review('b', 20), { c: 'x', t: 5, flag: 'f' }])).toBe(20);
  });
});

describe('paceHint', () => {
  it('ceil(remaining / (6 - (day - 1)))', () => {
    expect(paceHint(1, 282)).toBe(47);
    expect(paceHint(2, 235)).toBe(47);
    expect(paceHint(3, 100)).toBe(25);
    expect(paceHint(5, 7)).toBe(4);
    expect(paceHint(1, 0)).toBe(0);
  });
  it('after day 6 introduces everything that remains', () => {
    expect(paceHint(6, 30)).toBe(30);
    expect(paceHint(7, 30)).toBe(30);
    expect(paceHint(10, 5)).toBe(5);
  });
});

describe('windowInfo', () => {
  it('not started: day 0 and pace as if day 1', () => {
    const w = windowInfo({ now: local(5), firstReview: null, states: new Map(), total: 282, remainingNew: 282 });
    expect(w).toMatchObject({ phase: 'not-started', day: 0, leftToday: 47, targetToday: 47, onTrack: true, introduceAll: false });
  });

  it('running: counts what was already introduced today toward the target', () => {
    const first = local(5, 9);
    const states = new Map<string, CardState>();
    for (let i = 0; i < 20; i++) states.set(`c${i}`, stateFirstSeen(first + i * 1000));
    const w = windowInfo({ now: local(5, 11), firstReview: first, states, total: 120, remainingNew: 100 });
    expect(w.phase).toBe('running');
    expect(w.day).toBe(1);
    expect(w.introducedToday).toBe(20);
    expect(w.targetToday).toBe(20);
    expect(w.leftToday).toBe(0);
    expect(w.onTrack).toBe(true);
  });

  it('flags "behind" when too few concepts were introduced by the start of today', () => {
    const first = local(5, 9);
    const states = new Map<string, CardState>();
    for (let i = 0; i < 10; i++) states.set(`c${i}`, stateFirstSeen(first + i)); // all on day 1
    const behind = windowInfo({ now: local(8, 10), firstReview: first, states, total: 120, remainingNew: 110 });
    expect(behind.day).toBe(4);
    expect(behind.onTrack).toBe(false);
    expect(behind.leftToday).toBe(Math.ceil(110 / 3));
    const ok = new Map<string, CardState>();
    for (let i = 0; i < 60; i++) ok.set(`c${i}`, stateFirstSeen(first + i));
    expect(windowInfo({ now: local(8, 10), firstReview: first, states: ok, total: 120, remainingNew: 60 }).onTrack).toBe(true);
  });

  it('after day 6, introduce all remaining', () => {
    const first = local(5, 9);
    const w = windowInfo({ now: local(12, 10), firstReview: first, states: new Map(), total: 50, remainingNew: 12 });
    expect(w.day).toBe(8);
    expect(w.introduceAll).toBe(true);
    expect(w.leftToday).toBe(12);
  });

  it('is finished after day 10', () => {
    const first = local(5, 9);
    expect(windowInfo({ now: local(14, 23), firstReview: first, states: new Map(), total: 5, remainingNew: 0 }).phase).toBe('running');
    const w = windowInfo({ now: local(15, 1), firstReview: first, states: new Map(), total: 5, remainingNew: 0 });
    expect(w.phase).toBe('finished');
    expect(w.day).toBe(WINDOW_DAYS + 1);
  });
});
