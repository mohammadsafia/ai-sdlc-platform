// apps/desktop/src/main/jira/client.ts
import type { JiraIssueFields } from '../../shared/jira/push';

export class JiraApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'JiraApiError';
    this.status = status;
  }
}

export interface JiraClientConfig { baseUrl: string; email: string; apiToken: string }

export interface JiraIssueRaw {
  key: string;
  fields: {
    summary: string;
    status?: { name: string };
    issuetype?: { name: string };
    assignee?: { displayName?: string } | null;
    updated?: string;
    description?: unknown;
  };
}

export interface JiraTransition { id: string; name: string; to: { name: string } }

const SEARCH_FIELDS = ['summary', 'status', 'issuetype', 'assignee', 'updated'];
const BULK_CHUNK = 50;

/** Extract a readable message from a Jira error body. */
export function extractJiraError(status: number, body: unknown): string {
  const parts: string[] = [];
  if (body && typeof body === 'object') {
    const b = body as { errorMessages?: unknown; errors?: unknown; message?: unknown };
    if (Array.isArray(b.errorMessages)) parts.push(...b.errorMessages.map(String));
    if (b.errors && typeof b.errors === 'object') for (const [k, v] of Object.entries(b.errors as Record<string, unknown>)) parts.push(`${k}: ${String(v)}`);
    if (typeof b.message === 'string') parts.push(b.message);
  }
  return parts.length > 0 ? parts.join('; ') : `Jira request failed with HTTP ${status}`;
}

export class JiraClient {
  private readonly base: string;
  constructor(
    private readonly cfg: JiraClientConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
      'User-Agent': 'Appswave',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${this.base}/rest/api/3${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000));
      return this.request<T>(method, path, body, 1);
    }
    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* no body */
      }
      throw new JiraApiError(res.status, extractJiraError(res.status, parsed));
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  myself(): Promise<{ accountId: string; displayName: string }> {
    return this.request('GET', '/myself');
  }

  project(key: string): Promise<{ id: string; key: string; name: string; issueTypes: Array<{ id: string; name: string; subtask: boolean; hierarchyLevel?: number }> }> {
    return this.request('GET', `/project/${encodeURIComponent(key)}`);
  }

  async statuses(projectKey: string): Promise<string[]> {
    const raw = await this.request<Array<{ statuses: Array<{ name: string }> }>>('GET', `/project/${encodeURIComponent(projectKey)}/statuses`);
    const names: string[] = [];
    for (const t of raw) for (const s of t.statuses) if (!names.includes(s.name)) names.push(s.name);
    return names;
  }

  search(params: { jql: string; nextPageToken?: string; maxResults?: number }): Promise<{ issues: JiraIssueRaw[]; isLast: boolean; nextPageToken?: string }> {
    return this.request('POST', '/search/jql', {
      jql: params.jql,
      fields: SEARCH_FIELDS,
      maxResults: params.maxResults ?? 50,
      ...(params.nextPageToken ? { nextPageToken: params.nextPageToken } : {}),
    });
  }

  createIssue(fields: JiraIssueFields): Promise<{ key: string; id: string }> {
    return this.request('POST', '/issue', fields);
  }

  /** Bulk create in chunks of 50. Returns created keys by input index and per-index failures. */
  async createIssues(list: JiraIssueFields[]): Promise<{ created: Array<{ index: number; key: string }>; failed: Array<{ index: number; error: string }> }> {
    const created: Array<{ index: number; key: string }> = [];
    const failed: Array<{ index: number; error: string }> = [];
    for (let start = 0; start < list.length; start += BULK_CHUNK) {
      const chunk = list.slice(start, start + BULK_CHUNK);
      const res = await this.request<{ issues: Array<{ key: string }>; errors: Array<{ status: number; failedElementNumber?: number; elementErrors?: unknown }> }>('POST', '/issue/bulk', { issueUpdates: chunk });
      const failedIdx = new Set<number>();
      for (const e of res.errors ?? []) {
        const i = e.failedElementNumber ?? -1;
        if (i >= 0) {
          failedIdx.add(i);
          failed.push({ index: start + i, error: extractJiraError(e.status, e.elementErrors) });
        }
      }
      let next = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (failedIdx.has(i)) continue;
        const issue = res.issues?.[next++];
        if (issue) created.push({ index: start + i, key: issue.key });
      }
    }
    return { created, failed };
  }

  transitions(key: string): Promise<JiraTransition[]> {
    return this.request<{ transitions: JiraTransition[] }>('GET', `/issue/${encodeURIComponent(key)}/transitions`).then((r) => r.transitions ?? []);
  }

  transition(key: string, transitionId: string): Promise<void> {
    return this.request('POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: transitionId } });
  }

  issue(key: string): Promise<JiraIssueRaw> {
    return this.request('GET', `/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,description`);
  }
}
