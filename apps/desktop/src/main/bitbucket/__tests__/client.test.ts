import { describe, it, expect, vi } from 'vitest';
import { BitbucketApiError, BitbucketClient, extractBitbucketError } from '../client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch) {
  return new BitbucketClient({ email: 'a@b.c', apiToken: 'tok' }, fetchImpl);
}

describe('BitbucketClient', () => {
  it('sends basic auth and JSON headers to the 2.0 endpoint', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { display_name: 'Ann' }));
    expect(await client(f as unknown as typeof fetch).user()).toEqual({ displayName: 'Ann' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.bitbucket.org/2.0/user');
    const h = new Headers(init.headers);
    expect(h.get('authorization')).toBe(`Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(h.get('accept')).toBe('application/json');
    expect(h.get('accept-language')).toBe('en');
  });

  it('reads a repository', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { name: 'Todo', full_name: 'acme/todo', mainbranch: { name: 'develop' } }));
    expect(await client(f as unknown as typeof fetch).repository('acme', 'todo')).toEqual({ name: 'Todo', fullName: 'acme/todo', mainBranch: 'develop' });
    expect(f.mock.calls[0][0]).toBe('https://api.bitbucket.org/2.0/repositories/acme/todo');
  });

  it('finds an open pull request by source branch, or null', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, { values: [{ id: 7, links: { html: { href: 'https://bitbucket.org/acme/todo/pull-requests/7' } } }] }))
      .mockResolvedValueOnce(json(200, { values: [] }));
    const c = client(f as unknown as typeof fetch);
    expect(await c.findOpenPullRequest('acme', 'todo', 'auto-claude/001-x')).toEqual({ id: 7, url: 'https://bitbucket.org/acme/todo/pull-requests/7' });
    const url = new URL(f.mock.calls[0][0]);
    expect(url.pathname).toBe('/2.0/repositories/acme/todo/pullrequests');
    expect(url.searchParams.get('q')).toBe('source.branch.name = "auto-claude/001-x" AND state = "OPEN"');
    expect(await c.findOpenPullRequest('acme', 'todo', 'auto-claude/001-x')).toBeNull();
  });

  it('creates a pull request and returns its html link', async () => {
    const f = vi.fn().mockResolvedValue(json(201, { id: 9, links: { html: { href: 'https://bitbucket.org/acme/todo/pull-requests/9' } } }));
    const r = await client(f as unknown as typeof fetch).createPullRequest('acme', 'todo', {
      title: 'T', description: 'D', sourceBranch: 'auto-claude/001-x', destinationBranch: 'develop',
    });
    expect(r).toEqual({ id: 9, url: 'https://bitbucket.org/acme/todo/pull-requests/9' });
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      title: 'T', description: 'D', source: { branch: { name: 'auto-claude/001-x' } }, destination: { branch: { name: 'develop' } }, close_source_branch: false,
    });
  });

  it('throws BitbucketApiError with the API message on non-2xx', async () => {
    const f = vi.fn().mockImplementation(async () => json(400, { type: 'error', error: { message: 'Bad request', fields: { destination: ['Branch not found'] } } }));
    await expect(client(f as unknown as typeof fetch).user()).rejects.toMatchObject({ status: 400, message: 'Bad request; destination: Branch not found' });
    await expect(client(f as unknown as typeof fetch).user()).rejects.toBeInstanceOf(BitbucketApiError);
  });

  it('retries once on 429 using Retry-After', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(200, { display_name: 'Ann' }));
    await expect(client(f as unknown as typeof fetch).user()).resolves.toEqual({ displayName: 'Ann' });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('extractBitbucketError', () => {
  it('falls back to the HTTP status', () => {
    expect(extractBitbucketError(502, 'gateway')).toBe('Bitbucket request failed with HTTP 502');
    expect(extractBitbucketError(401, { error: {} })).toBe('Bitbucket request failed with HTTP 401');
  });
  it('joins message and field errors without repeating text', () => {
    expect(extractBitbucketError(400, { error: { message: 'X', fields: { a: ['X'], b: ['Y', 'Z'] } } })).toBe('X; b: Y, Z');
  });
});
