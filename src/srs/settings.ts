export interface Settings {
  /** Target recall for FSRS (request_retention). */
  targetRecall: number;
}

export const DEFAULT_SETTINGS: Settings = { targetRecall: 0.9 };
export const MIN_RECALL = 0.8;
export const MAX_RECALL = 0.97;

export function clampRecall(x: number): number {
  if (!Number.isFinite(x)) return DEFAULT_SETTINGS.targetRecall;
  return Math.min(MAX_RECALL, Math.max(MIN_RECALL, Math.round(x * 100) / 100));
}
