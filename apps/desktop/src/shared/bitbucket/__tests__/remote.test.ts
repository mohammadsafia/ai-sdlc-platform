import { describe, it, expect } from 'vitest';
import { parseBitbucketRemote } from '../remote';

describe('parseBitbucketRemote', () => {
  it.each([
    ['git@bitbucket.org:acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['ssh://git@bitbucket.org/acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://bitbucket.org/acme/todo', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://ann@bitbucket.org/acme/todo.git', { workspace: 'acme', repoSlug: 'todo' }],
    ['https://bitbucket.org/acme/todo/', { workspace: 'acme', repoSlug: 'todo' }],
  ])('parses %s', (url, expected) => {
    expect(parseBitbucketRemote(url)).toEqual(expected);
  });

  it('returns null for other hosts and malformed urls', () => {
    expect(parseBitbucketRemote('git@github.com:acme/todo.git')).toBeNull();
    expect(parseBitbucketRemote('https://gitlab.com/acme/todo.git')).toBeNull();
    expect(parseBitbucketRemote('https://bitbucket.org/acme')).toBeNull();
    expect(parseBitbucketRemote('')).toBeNull();
  });
});
