// apps/desktop/src/main/bitbucket/client.ts
import type { BitbucketProjectConfig } from './config';

const BASE_URL = 'https://api.bitbucket.org/2.0';

export class BitbucketApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BitbucketApiError';
  }
}

/** Human-readable message from a Bitbucket error body, falling back to the HTTP status. */
export function extractBitbucketError(status: number, body: unknown): string {
  const parts: string[] = [];
  if (body && typeof body === 'object') {
    const err = (body as { error?: { message?: unknown; fields?: unknown } }).error;
    if (err && typeof err === 'object') {
      if (typeof err.message === 'string' && err.message.trim()) parts.push(err.message.trim());
      if (err.fields && typeof err.fields === 'object') {
        for (const [field, value] of Object.entries(err.fields as Record<string, unknown>)) {
          const msgs = (Array.isArray(value) ? value : [value]).map(String).filter((m) => !parts.includes(m));
          if (msgs.length > 0) parts.push(`${field}: ${msgs.join(', ')}`);
        }
      }
    }
  }
  return parts.length > 0 ? parts.join('; ') : `Bitbucket request failed with HTTP ${status}`;
}

export interface BitbucketUser {
  displayName: string;
}
export interface BitbucketRepository {
  name: string;
  fullName: string;
  mainBranch?: string;
}
export interface BitbucketPullRequestRef {
  id: number;
  url: string;
}
export interface CreatePullRequestInput {
  title: string;
  description: string;
  sourceBranch: string;
  destinationBranch: string;
}

type PullRequestJson = { id: number; links?: { html?: { href?: string } } };

export class BitbucketClient {
  constructor(
    private readonly cfg: { email: string; apiToken: string },
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, attempt = 0): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.cfg.email}:${this.cfg.apiToken}`).toString('base64')}`,
      Accept: 'application/json',
      'Accept-Language': 'en',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get('retry-after') ?? '2');
      await new Promise((r) => setTimeout(r, Math.max(0, wait) * 1000));
      return this.request<T>(method, path, body, 1);
    }
    const text = await res.text();
    let parsed: unknown;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new BitbucketApiError(res.status, extractBitbucketError(res.status, parsed));
    return parsed as T;
  }

  private repoPath(workspace: string, repoSlug: string): string {
    return `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
  }

  async user(): Promise<BitbucketUser> {
    const u = await this.request<{ display_name?: string; username?: string }>('GET', '/user');
    return { displayName: u.display_name ?? u.username ?? '' };
  }

  async repository(workspace: string, repoSlug: string): Promise<BitbucketRepository> {
    const r = await this.request<{ name: string; full_name: string; mainbranch?: { name?: string } }>(
      'GET',
      this.repoPath(workspace, repoSlug),
    );
    return { name: r.name, fullName: r.full_name, mainBranch: r.mainbranch?.name };
  }

  async findOpenPullRequest(workspace: string, repoSlug: string, sourceBranch: string): Promise<BitbucketPullRequestRef | null> {
    const q = `source.branch.name = "${sourceBranch.replace(/"/g, '\\"')}" AND state = "OPEN"`;
    const page = await this.request<{ values?: PullRequestJson[] }>(
      'GET',
      `${this.repoPath(workspace, repoSlug)}/pullrequests?q=${encodeURIComponent(q)}&pagelen=1`,
    );
    const first = page.values?.[0];
    if (!first) return null;
    return { id: first.id, url: first.links?.html?.href ?? '' };
  }

  async createPullRequest(workspace: string, repoSlug: string, input: CreatePullRequestInput): Promise<BitbucketPullRequestRef> {
    const pr = await this.request<PullRequestJson>('POST', `${this.repoPath(workspace, repoSlug)}/pullrequests`, {
      title: input.title,
      description: input.description,
      source: { branch: { name: input.sourceBranch } },
      destination: { branch: { name: input.destinationBranch } },
      close_source_branch: false,
    });
    return { id: pr.id, url: pr.links?.html?.href ?? '' };
  }
}

export function createBitbucketClient(config: BitbucketProjectConfig): BitbucketClient {
  return new BitbucketClient({ email: config.email, apiToken: config.apiToken });
}
