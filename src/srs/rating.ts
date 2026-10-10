export type Rating = 1 | 2 | 3 | 4;
export type Confidence = 'guessed' | 'knew' | 'easy';

/** Auto-checked items: wrong is always Again; right is Guessed=Hard, Knew it=Good, Easy. */
export function autoRating(correct: boolean, confidence: Confidence = 'knew'): Rating {
  if (!correct) return 1;
  return confidence === 'guessed' ? 2 : confidence === 'easy' ? 4 : 3;
}

export const RATING_LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };
