// apps/desktop/src/shared/jira/__tests__/status-map.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_JIRA_STATUS_MAP, parseStatusMap, serializeStatusMap, targetStatusFor } from '../status-map';

describe('status map', () => {
  it('defaults when text is missing or malformed', () => {
    expect(parseStatusMap(undefined)).toEqual(DEFAULT_JIRA_STATUS_MAP);
    expect(parseStatusMap('garbage')).toEqual(DEFAULT_JIRA_STATUS_MAP);
  });
  it('parses the compact form, empty name means not synced, unknown statuses ignored', () => {
    const map = parseStatusMap('backlog:Selected for Development;done:Closed;error:;bogus:X');
    expect(map.backlog).toBe('Selected for Development');
    expect(map.done).toBe('Closed');
    expect(map.error).toBeNull();
    expect(map.in_progress).toBe('In Progress');
  });
  it('round-trips through serialize', () => {
    const map = { ...DEFAULT_JIRA_STATUS_MAP, human_review: 'In Review', error: null };
    expect(parseStatusMap(serializeStatusMap(map))).toEqual(map);
  });
  it('targetStatusFor returns the mapped name or null', () => {
    expect(targetStatusFor(DEFAULT_JIRA_STATUS_MAP, 'done')).toBe('Done');
    expect(targetStatusFor(DEFAULT_JIRA_STATUS_MAP, 'error')).toBeNull();
  });
});
