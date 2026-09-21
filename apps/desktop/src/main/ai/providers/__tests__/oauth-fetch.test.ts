import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOAuthProviderFetch } from '../oauth-fetch';

const CODEX = 'https://chatgpt.com/backend-api/codex/responses';

function sse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

let dir: string;
let tokenFile: string;
const realFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'oauth-fetch-'));
  tokenFile = path.join(dir, 'codex-auth.json');
  writeFileSync(tokenFile, JSON.stringify({ access_token: 'tok', refresh_token: 'ref', expires_at: Date.now() + 3_600_000 }));
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe('createOAuthProviderFetch (openai / Codex)', () => {
  it('rewrites the URL, injects the token, and forces store=false on streaming requests', async () => {
    fetchMock.mockResolvedValue(sse([{ type: 'response.completed', response: { id: 'r1' } }]));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer placeholder' },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'hi', stream: true }),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CODEX);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual({ model: 'gpt-5.5', input: 'hi', stream: true, store: false });
    // Streaming requests pass the SSE body through untouched
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('turns a non-streaming request into a stream and returns the completed response as JSON', async () => {
    const completed = { id: 'resp_1', object: 'response', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'pong' }] }], usage: { input_tokens: 1, output_tokens: 1 } };
    fetchMock.mockResolvedValue(sse([
      { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
      { type: 'response.output_text.delta', delta: 'pong' },
      { type: 'response.completed', response: completed },
    ]));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5', input: 'hi' }),
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ stream: true, store: false });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(completed);
  });

  it('rebuilds output from output_item.done events when the terminal event has an empty output', async () => {
    const item = { id: 'msg_1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'pong' }] };
    fetchMock.mockResolvedValue(sse([
      { type: 'response.output_item.added', item: { id: 'msg_1', type: 'message', content: [] } },
      { type: 'response.output_item.done', item },
      { type: 'response.completed', response: { id: 'resp_3', status: 'completed', output: [], usage: { total_tokens: 3 } } },
    ]));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'x', input: 'hi' }) });
    expect(await res.json()).toEqual({ id: 'resp_3', status: 'completed', output: [item], usage: { total_tokens: 3 } });
  });

  it('collapses the stream even when the backend omits content-type', async () => {
    const completed = { id: 'resp_2', status: 'completed', output: [] };
    const body = `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: completed })}\n\n`;
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'x', input: 'hi' }) });
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual(completed);
  });

  it('passes backend errors through unchanged for non-streaming requests', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'nope' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'x', input: 'hi' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail: 'nope' });
  });

  it('surfaces a failed response as an error status instead of hanging', async () => {
    fetchMock.mockResolvedValue(sse([{ type: 'response.failed', response: { id: 'r', status: 'failed', error: { code: 'server_error', message: 'boom' } } }]));
    const f = createOAuthProviderFetch(tokenFile, 'openai');
    const res = await f('https://api.openai.com/v1/responses', { method: 'POST', body: JSON.stringify({ model: 'x', input: 'hi' }) });
    expect(res.ok).toBe(false);
    expect(await res.text()).toContain('boom');
  });
});
