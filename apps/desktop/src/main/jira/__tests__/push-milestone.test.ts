// apps/desktop/src/main/jira/__tests__/push-milestone.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequirementsSet } from '../../../shared/types/requirements';

const { files, cfg, clientMock, fsMock } = vi.hoisted(() => ({
  files: { readRequirements: vi.fn(), writeRequirements: vi.fn() },
  cfg: { getJiraConfig: vi.fn(), createJiraClient: vi.fn() },
  clientMock: { createIssue: vi.fn(), createIssues: vi.fn(), browseUrl: (k: string) => `https://j/browse/${k}` },
  fsMock: { readFileSync: vi.fn(), writeFileSync: vi.fn(), existsSync: vi.fn(() => true) },
}));
vi.mock('../../brd/requirements-files', () => files);
vi.mock('../config', () => cfg);
vi.mock('node:fs', () => fsMock);

import { pushMilestoneToJira } from '../push-milestone';

const project = { id: 'p1', path: '/repo', autoBuildPath: '.auto-claude' };
const base: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'H', status: 'approved', generatedAt: 't', requirements: [],
  milestones: [{ id: 'M1', name: 'Core', description: 'd', order: 1, included: true }],
  tasks: [
    { id: 'T1', title: 'One', description: 'd', milestoneId: 'M1', requirementIds: [], category: 'feature', order: 1, included: true },
    { id: 'T2', title: 'Two', description: 'd', milestoneId: 'M1', requirementIds: [], category: 'feature', order: 2, included: true },
  ],
  releases: { M1: { releasedAt: 't', tasks: [{ proposedTaskId: 'T1', specId: '001-one' }, { proposedTaskId: 'T2', specId: '002-two' }] } },
};

beforeEach(() => {
  vi.clearAllMocks();
  cfg.getJiraConfig.mockReturnValue({ baseUrl: 'https://j', email: 'e', apiToken: 't', projectKey: 'ACME', issueType: 'Task', epicIssueType: 'Epic', statusMap: {} });
  cfg.createJiraClient.mockReturnValue(clientMock);
  files.writeRequirements.mockImplementation(async (_p: string, _s: string, s: RequirementsSet) => s);
  fsMock.readFileSync.mockImplementation((p: string) => (String(p).endsWith('implementation_plan.json') ? JSON.stringify({ description: '# Body' }) : JSON.stringify({ sourceType: 'requirements' })));
});

describe('pushMilestoneToJira', () => {
  it('creates the epic, then issues in bulk, records keys, and stamps task metadata', async () => {
    files.readRequirements.mockResolvedValue(base);
    clientMock.createIssue.mockResolvedValue({ key: 'ACME-1', id: '1' });
    clientMock.createIssues.mockResolvedValue({ created: [{ index: 0, key: 'ACME-2' }, { index: 1, key: 'ACME-3' }], failed: [] });
    const r = await pushMilestoneToJira(project, 'a', 'M1');
    expect(clientMock.createIssue.mock.calls[0][0].fields).toMatchObject({ summary: 'Core', issuetype: { name: 'Epic' }, project: { key: 'ACME' } });
    expect(clientMock.createIssues.mock.calls[0][0][0].fields).toMatchObject({ summary: 'One', parent: { key: 'ACME-1' } });
    expect(r.set.releases?.M1.jira).toMatchObject({ epicKey: 'ACME-1', issues: { T1: 'ACME-2', T2: 'ACME-3' } });
    expect(r.warnings).toEqual([]);
    const stamped = fsMock.writeFileSync.mock.calls.filter(([p]) => String(p).endsWith('task_metadata.json'));
    expect(stamped).toHaveLength(2);
    expect(JSON.parse(stamped[0][1] as string)).toMatchObject({ jiraKey: 'ACME-2', jiraEpicKey: 'ACME-1', jiraUrl: 'https://j/browse/ACME-2' });
    expect(files.writeRequirements).toHaveBeenCalledTimes(2); // after epic, after batch
  });

  it('reuses an existing epic, skips keyed tasks, and warns on per-issue failures', async () => {
    const partial: RequirementsSet = { ...base, releases: { M1: { ...base.releases!.M1, jira: { epicKey: 'ACME-1', issues: { T1: 'ACME-2' }, pushedAt: 't' } } } };
    files.readRequirements.mockResolvedValue(partial);
    clientMock.createIssues.mockResolvedValue({ created: [], failed: [{ index: 0, error: 'nope' }] });
    const r = await pushMilestoneToJira(project, 'a', 'M1');
    expect(clientMock.createIssue).not.toHaveBeenCalled();
    expect(clientMock.createIssues.mock.calls[0][0]).toHaveLength(1);
    expect(r.warnings).toEqual(['Could not create a Jira issue for T2 (Two): nope']);
    expect(r.set.releases?.M1.jira?.issues).toEqual({ T1: 'ACME-2' });
  });

  it('refuses when Jira is not configured or the milestone is not released', async () => {
    files.readRequirements.mockResolvedValue(base);
    cfg.getJiraConfig.mockReturnValueOnce(null);
    await expect(pushMilestoneToJira(project, 'a', 'M1')).rejects.toThrow('Jira is not configured for this project');
    await expect(pushMilestoneToJira(project, 'a', 'M9')).rejects.toThrow('Release the milestone before pushing it to Jira');
  });
});
