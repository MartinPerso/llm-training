import { describe, expect, it } from 'vitest';
import { review } from '../test/helpers.ts';
import { emptyProgress, serializeProgress, type ProgressFile } from '../srs/events.ts';
import type { RemoteConfig } from './config.ts';
import { decodeBase64Utf8, encodeBase64Utf8, GitHubError, pull, push } from './github.ts';
import { FakeGitHub } from './fakeGitHub.ts';

const cfg: RemoteConfig = { token: 'test-token', repo: 'me/progress', branch: 'main', path: 'progress.json' };
const file = (events: ProgressFile['events']): ProgressFile => ({ ...emptyProgress(), events });

describe('base64 UTF-8', () => {
  it('round-trips accents, Greek and emoji', () => {
    const text = 'é θ 🧠 日本語 ✓ plain';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });
  it('decodes GitHub-style base64 with line breaks', () => {
    const b64 = encodeBase64Utf8('héllo wörld θ🧠'.repeat(10));
    const wrapped = b64.replace(/(.{60})/g, '$1\n');
    expect(decodeBase64Utf8(wrapped)).toBe('héllo wörld θ🧠'.repeat(10));
  });
  it('handles large inputs without blowing the stack', () => {
    const big = 'x'.repeat(500_000);
    expect(decodeBase64Utf8(encodeBase64Utf8(big))).toBe(big);
  });
});

describe('pull', () => {
  it('sends the right request and decodes the file', async () => {
    const gh = new FakeGitHub(file([review('a', 1)]));
    const res = await pull(cfg, gh.fetch);
    expect(res.file.events).toHaveLength(1);
    expect(res.sha).toBe(gh.sha);
    const req = gh.requests[0]!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.github.com/repos/me/progress/contents/progress.json?ref=main');
    expect(req.headers['Authorization']).toBe('Bearer test-token');
    expect(req.headers['Accept']).toBe('application/vnd.github+json');
    expect(req.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
    expect(req.cache).toBe('no-store');
  });

  it('treats an empty or {} file as empty progress', async () => {
    const gh = new FakeGitHub();
    gh.setRaw('{}');
    expect((await pull(cfg, gh.fetch)).file.events).toEqual([]);
    gh.setRaw('');
    expect((await pull(cfg, gh.fetch)).file.events).toEqual([]);
  });

  it('refuses to treat invalid JSON as empty (it would be overwritten)', async () => {
    const gh = new FakeGitHub();
    gh.setRaw('{ nope');
    await expect(pull(cfg, gh.fetch)).rejects.toThrow(/not valid JSON/);
  });

  it.each([
    [401, 'auth', /invalid or expired/],
    [403, 'access', /lacks access/],
    [404, 'notfound', /Not found/],
  ])('maps HTTP %i to a clear error', async (status, kind, message) => {
    const gh = new FakeGitHub();
    gh.failNext(status);
    const err = await pull(cfg, gh.fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).kind).toBe(kind);
    expect((err as GitHubError).message).toMatch(message);
  });

  it('maps a network failure', async () => {
    const gh = new FakeGitHub();
    gh.offline = true;
    const err = await pull(cfg, gh.fetch).catch((e: unknown) => e);
    expect((err as GitHubError).kind).toBe('network');
  });
});

describe('push', () => {
  it('PUTs base64 UTF-8 content with message, sha and branch', async () => {
    const gh = new FakeGitHub();
    const { sha } = await pull(cfg, gh.fetch);
    const local = file([{ ...review('x', 5), a: 'café θ 🧠' }]);
    const res = await push(cfg, local, sha, { device: 'phone', fetch: gh.fetch });
    const put = gh.requests.find((r) => r.method === 'PUT')!;
    expect(put.body.message).toBe('Sync progress (phone)');
    expect(put.body.sha).toBe(sha);
    expect(put.body.branch).toBe('main');
    expect(decodeBase64Utf8(put.body.content as string)).toBe(serializeProgress(local));
    expect(res.sha).toBe(gh.sha);
    expect(res.sha).not.toBe(sha);
    expect(gh.current().events[0]).toMatchObject({ a: 'café θ 🧠' });
  });

  it('on a sha conflict: pulls, merges and retries, keeping both devices\' events', async () => {
    const gh = new FakeGitHub(file([review('a', 1)]));
    const { sha, file: base } = await pull(cfg, gh.fetch);
    gh.externalWrite(file([review('a', 1), review('other-device', 2)])); // the other device pushes meanwhile
    const mine = file([...base.events, review('this-device', 3)]);
    const res = await push(cfg, mine, sha, { device: 'computer', fetch: gh.fetch });
    expect(gh.puts).toBe(2); // first rejected (409), second accepted
    const ids = gh.current().events.map((e) => e.c);
    expect(ids).toEqual(['a', 'other-device', 'this-device']);
    expect(res.file.events).toHaveLength(3);
  });

  it('retries on 422 too, at most 3 attempts, then gives a clear error', async () => {
    const gh = new FakeGitHub();
    const { sha } = await pull(cfg, gh.fetch);
    gh.alwaysConflict = 422;
    const err = await push(cfg, file([review('x', 1)]), sha, { device: 'd', fetch: gh.fetch }).catch((e: unknown) => e);
    expect(gh.puts).toBe(3);
    expect((err as GitHubError).kind).toBe('conflict');
  });

  it('does not retry auth errors', async () => {
    const gh = new FakeGitHub();
    const { sha } = await pull(cfg, gh.fetch);
    gh.failNext(401, 'PUT');
    const err = await push(cfg, file([review('x', 1)]), sha, { device: 'd', fetch: gh.fetch }).catch((e: unknown) => e);
    expect((err as GitHubError).kind).toBe('auth');
    expect(gh.puts).toBe(1);
  });
});
