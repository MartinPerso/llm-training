import { useEffect, useState } from 'react';
import type { SyncStatus } from '../storage/sync.ts';

export function relativeTime(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function statusLabel(st: SyncStatus, now: number): string {
  const n = st.pendingCount;
  switch (st.state) {
    case 'local-only':
      return 'local only';
    case 'syncing':
      return 'syncing…';
    case 'offline':
      return n ? `offline · ${n} pending` : 'offline';
    case 'error':
      return 'sync error';
    case 'pending':
      return n ? `${n} answer${n === 1 ? '' : 's'} pending` : 'not synced yet';
    case 'synced':
      return st.lastSyncedAt ? `synced ${relativeTime(st.lastSyncedAt, now)}` : 'synced';
  }
}

export default function SyncChip({ status, onClick }: { status: SyncStatus; onClick?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <button
      type="button"
      className={`chip chip-${status.state}`}
      onClick={onClick}
      title={status.error ?? 'Sync status'}
    >
      <span className="dot" aria-hidden="true" />
      {statusLabel(status, now)}
    </button>
  );
}
