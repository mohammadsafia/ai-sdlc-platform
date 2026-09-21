export interface BitbucketRepoRef {
  workspace: string;
  repoSlug: string;
}

const SSH_SCP = /^git@bitbucket\.org:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_URL = /^ssh:\/\/git@bitbucket\.org\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const HTTPS = /^https?:\/\/(?:[^@/]+@)?bitbucket\.org\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/** Workspace and repo slug from a bitbucket.org remote URL, or null for any other host. */
export function parseBitbucketRemote(url: string): BitbucketRepoRef | null {
  const trimmed = url.trim();
  for (const re of [SSH_SCP, SSH_URL, HTTPS]) {
    const m = trimmed.match(re);
    if (m) return { workspace: m[1].toLowerCase(), repoSlug: m[2].toLowerCase() };
  }
  return null;
}
