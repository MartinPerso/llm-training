import { useEffect, useRef, useState } from 'react';
import { clampRecall, MAX_RECALL, MIN_RECALL } from '../srs/settings.ts';
import { parseProgress, serializeProgress } from '../srs/events.ts';
import {
  DEFAULT_BRANCH,
  DEFAULT_REPO,
  getDevice,
  getRepo,
  getToken,
  PROGRESS_PATH,
  setDevice,
  setRepo,
  setToken,
} from '../storage/config.ts';
import { pull } from '../storage/github.ts';
import { sync } from '../storage/instance.ts';
import SyncChip from './SyncChip.tsx';
import { useProgress } from './useProgress.ts';

export default function Settings() {
  const { file, status } = useProgress();
  const [tokenInput, setTokenInput] = useState('');
  const [hasToken, setHasToken] = useState(() => getToken() !== '');
  const [repo, setRepoInput] = useState(() => getRepo());
  const [device, setDeviceInput] = useState(() => getDevice());
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recall, setRecall] = useState(file.settings.targetRecall);
  const fileInput = useRef<HTMLInputElement>(null);

  // Follow settings that arrive from another device.
  useEffect(() => setRecall(file.settings.targetRecall), [file.settings.targetRecall]);

  // Commit the slider after a short pause so one drag is one change.
  useEffect(() => {
    if (clampRecall(recall) === file.settings.targetRecall) return;
    const id = setTimeout(() => void sync.updateSettings({ targetRecall: recall }), 400);
    return () => clearTimeout(id);
  }, [recall, file.settings.targetRecall]);

  const say = (kind: 'ok' | 'error', text: string) => setMessage({ kind, text });

  const saveConnection = () => {
    if (tokenInput.trim()) {
      setToken(tokenInput);
      setHasToken(true);
      setTokenInput('');
    }
    setRepo(repo || DEFAULT_REPO);
    setDevice(device || '');
    sync.configChanged();
    say('ok', 'Saved on this device.');
  };

  const removeToken = () => {
    setToken('');
    setHasToken(false);
    sync.configChanged();
    say('ok', 'Token removed from this device. Progress stays local.');
  };

  const testConnection = async () => {
    const token = tokenInput.trim() || getToken();
    if (!token) return say('error', 'Enter a token first.');
    setBusy(true);
    try {
      const remote = await pull({ token, repo: repo || DEFAULT_REPO, branch: DEFAULT_BRANCH, path: PROGRESS_PATH });
      say('ok', `Connected. progress.json has ${remote.file.events.length} events (version ${remote.sha.slice(0, 7)}).`);
    } catch (e) {
      say('error', e instanceof Error ? e.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    await sync.syncNow();
    setBusy(false);
    const st = sync.getSnapshot().status;
    if (st.state === 'local-only') say('error', 'No token set: progress is only stored on this device.');
    else if (st.error) say('error', st.error);
    else say('ok', 'Synced.');
  };

  const exportProgress = () => {
    const blob = new Blob([serializeProgress(sync.getSnapshot().file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm-quiz-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importProgress = async (f: File | undefined) => {
    if (!f) return;
    try {
      const incoming = parseProgress(JSON.parse(await f.text()));
      const before = sync.getSnapshot().file.events.length;
      await sync.importFile(incoming);
      const added = sync.getSnapshot().file.events.length - before;
      say('ok', `Imported ${incoming.events.length} events (${added} new).`);
    } catch {
      say('error', 'That file is not a valid progress export.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const reset = async () => {
    if (!window.confirm('Delete all progress stored on this device? Progress already synced to GitHub is not deleted.')) return;
    await sync.resetLocal();
    say('ok', 'Local data cleared.');
  };

  return (
    <section className="screen">
      <h1>Settings</h1>

      <h2>Sync</h2>
      <div className="row between">
        <SyncChip status={status} />
        <button type="button" className="btn" onClick={() => void syncNow()} disabled={busy}>
          Sync now
        </button>
      </div>
      {status.error && <p className="warn small">{status.error}</p>}

      <label className="field">
        <span>GitHub token</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder={hasToken ? 'A token is saved. Paste a new one to replace it.' : 'github_pat_…'}
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Progress repo</span>
        <input className="input" type="text" autoComplete="off" spellCheck={false} value={repo} onChange={(e) => setRepoInput(e.target.value)} />
      </label>
      <label className="field">
        <span>Device name</span>
        <input className="input" type="text" autoComplete="off" value={device} onChange={(e) => setDeviceInput(e.target.value)} />
      </label>
      <div className="row">
        <button type="button" className="btn primary" onClick={saveConnection}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => void testConnection()} disabled={busy}>
          Test connection
        </button>
        {hasToken && (
          <button type="button" className="btn" onClick={removeToken}>
            Remove token
          </button>
        )}
      </div>
      <p className="muted small">
        The token stays on this device (localStorage) and is only ever sent to api.github.com. Use a fine-grained token limited to the
        progress repo (Contents: read and write).
      </p>
      {message && <p className={message.kind === 'ok' ? 'ok' : 'warn'}>{message.text}</p>}

      <h2>Practice</h2>
      <label className="field">
        <span>Target recall: {Math.round(recall * 100)}%</span>
        <input
          type="range"
          min={MIN_RECALL}
          max={MAX_RECALL}
          step={0.01}
          value={recall}
          onChange={(e) => setRecall(Number(e.target.value))}
        />
      </label>
      <p className="muted small">Higher means more repetitions. The default is 90%.</p>

      <h2>Data</h2>
      <div className="row">
        <button type="button" className="btn" onClick={exportProgress}>
          Export progress
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          Import progress
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => void importProgress(e.target.files?.[0])} />
      </div>
      <div className="row">
        <button type="button" className="btn danger" onClick={() => void reset()}>
          Reset local data
        </button>
      </div>
    </section>
  );
}
