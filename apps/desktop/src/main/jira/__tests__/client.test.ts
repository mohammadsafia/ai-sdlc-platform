// apps/desktop/src/main/jira/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { JiraApiError, JiraClient } from '../client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function client(fetchImpl: typeof fetch) {
  return new JiraClient({ baseUrl: 'https://acme.atlassian.net', email: 'a@b.c', apiToken: 'tok' }, fetchImpl);
}

describe('JiraClient', () => {
  it('sends basic auth and JSON headers to the v3 endpoint', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { accountId: '1', displayName: 'Ann' }));
    const me = await client(f as unknown as typeof fetch).myself();
    expect(me).toEqual({ accountId: '1', displayName: 'Ann' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/myself');
    expect(new Headers(init.headers).get('authorization')).toBe(`Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
  });

  it('throws JiraApiError with Jira messages on non-2xx', async () => {
    const f = vi.fn().mockResolvedValue(json(400, { errorMessages: ['Bad'], errors: { summary: 'required' } }));
    await expect(client(f as unknown as typeof fetch).project('ACME')).rejects.toMatchObject({ status: 400, message: 'Bad; summary: required' });
    await expect(client(f as unknown as typeof fetch).project('ACME')).rejects.toBeInstanceOf(JiraApiError);
  });

  it('retries once on 429 using Retry-After', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(200, { accountId: '1', displayName: 'Ann' }));
    await expect(client(f as unknown as typeof fetch).myself()).resolves.toMatchObject({ displayName: 'Ann' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('dedupes statuses across issue types and chunks bulk creation at 50', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, [{ statuses: [{ name: 'To Do' }, { name: 'Done' }] }, { statuses: [{ name: 'Done' }] }]))
      .mockResolvedValueOnce(json(201, { issues: Array.from({ length: 50 }, (_, i) => ({ key: `A-${i}` })), errors: [] }))
      .mockResolvedValueOnce(json(201, { issues: [{ key: 'A-50' }], errors: [] }));
    const c = client(f as unknown as typeof fetch);
    expect(await c.statuses('ACME')).toEqual(['To Do', 'Done']);
    const list = Array.from({ length: 51 }, (_, i) => ({ fields: { project: { key: 'ACME' }, summary: `s${i}`, issuetype: { name: 'Task' }, description: { version: 1 as const, type: 'doc' as const, content: [] } } }));
    const r = await c.createIssues(list);
    expect(f).toHaveBeenCalledTimes(3);
    expect(JSON.parse(f.mock.calls[1][1].body).issueUpdates).toHaveLength(50);
    expect(r.created).toHaveLength(51);
    expect(r.created[50]).toEqual({ index: 50, key: 'A-50' });
  });

  it('maps bulk per-element errors back to input indexes', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(201, { issues: [{ key: 'A-1' }], errors: [{ status: 400, failedElementNumber: 0, elementErrors: { errorMessages: ['nope'], errors: {} } }] }));
    const c = client(f as unknown as typeof fetch);
    const mk = (s: string) => ({ fields: { project: { key: 'ACME' }, summary: s, issuetype: { name: 'Task' }, description: { version: 1 as const, type: 'doc' as const, content: [] } } });
    const r = await c.createIssues([mk('a'), mk('b')]);
    expect(r.created).toEqual([{ index: 1, key: 'A-1' }]);
    expect(r.failed).toEqual([{ index: 0, error: 'nope' }]);
  });

  it('search posts JQL with a page token and builds browse URLs', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { issues: [], isLast: true }));
    const c = client(f as unknown as typeof fetch);
    await c.search({ jql: 'project = ACME', nextPageToken: 'p2' });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ jql: 'project = ACME', nextPageToken: 'p2', maxResults: 50 });
    expect(body.fields).toContain('summary');
    expect(c.browseUrl('ACME-1')).toBe('https://acme.atlassian.net/browse/ACME-1');
  });
});
