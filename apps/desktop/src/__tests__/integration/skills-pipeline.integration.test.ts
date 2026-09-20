// apps/desktop/src/__tests__/integration/skills-pipeline.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { refreshSkills, resolveSkills } from '../../main/ai/skills/resolve';
import { createGitRunner } from '../../main/ai/skills/sync';
import { buildSkillsSectionForAgent } from '../../main/ai/agent/skills-prompt';
import { injectContext } from '../../main/ai/prompts/prompt-loader';
import { loadSkillTool } from '../../main/ai/tools/builtin/load-skill';
import type { ToolContext } from '../../main/ai/tools/types';

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}
function writeSkill(root: string, name: string, body: string, files: Record<string, string> = {}) {
  mkdirSync(path.join(root, name), { recursive: true });
  writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name, rel)), { recursive: true });
    writeFileSync(path.join(root, name, rel), content);
  }
}

describe('skills pipeline integration', () => {
  let tmp: string;
  let projectDir: string;
  let specDir: string;
  let userDataDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), 'skills-e2e-'));
    projectDir = path.join(tmp, 'project');
    specDir = path.join(projectDir, '.auto-claude', 'specs', '001-demo');
    userDataDir = path.join(tmp, 'userData');
    mkdirSync(specDir, { recursive: true });
    mkdirSync(userDataDir);

    const work = path.join(tmp, 'central-work');
    mkdirSync(path.join(work, 'skills'), { recursive: true });
    git(['init', '-q', '-b', 'main'], work);
    writeSkill(path.join(work, 'skills'), 'api-standards', 'ALWAYS version endpoints.', { 'references/errors.md': 'Use RFC 7807.' });
    git(['add', '.'], work);
    git(['commit', '-q', '-m', 'init'], work);
    const bare = path.join(tmp, 'central.git');
    git(['clone', '-q', '--bare', work, bare], tmp);

    writeSkill(path.join(projectDir, '.claude', 'skills'), 'fe-standards', 'Use function components.');
    writeFileSync(
      path.join(projectDir, '.claude', 'skills.json'),
      JSON.stringify({ centralRepos: [{ url: `file://${bare}` }], pins: { coding: ['fe-standards'] } }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('refresh → resolve → coder prompt has pinned body and catalog → load_skill reads central skill and resource', async () => {
    const opts = { userDataDir, git: createGitRunner(), allowedSchemes: ['file:'] as const };
    const refreshed = await refreshSkills(projectDir, opts);
    expect(refreshed.error).toBeUndefined();

    const snapshot = await resolveSkills(projectDir, opts);
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.skills.map((s) => s.name).sort()).toEqual(['api-standards', 'fe-standards']);

    const section = await buildSkillsSectionForAgent(snapshot, 'coder', specDir);
    const prompt = injectContext('BASE PROMPT', { specDir, projectDir, skillsSection: section });
    expect(prompt).toContain('Use function components.');           // pinned body
    expect(prompt).toContain('| api-standards | api-standards description |'); // catalog row
    expect(prompt.indexOf('## PROJECT SKILLS')).toBeLessThan(prompt.indexOf('BASE PROMPT'));

    const qaSection = await buildSkillsSectionForAgent(snapshot, 'qa_reviewer', specDir);
    expect(qaSection).not.toContain('### Pinned skills');
    expect(qaSection).toContain('| fe-standards |');

    const ctx = { cwd: projectDir, projectDir, specDir, securityProfile: {} as ToolContext['securityProfile'], skillsSnapshot: snapshot, agentType: 'coder' } as ToolContext;
    const body = (await loadSkillTool.config.execute({ name: 'api-standards' }, ctx)) as string;
    expect(body).toContain('ALWAYS version endpoints.');
    expect(body).toContain('references/errors.md');
    const resource = (await loadSkillTool.config.execute({ name: 'api-standards', resource: 'references/errors.md' }, ctx)) as string;
    expect(resource).toBe('Use RFC 7807.');

    const usage = JSON.parse(readFileSync(path.join(specDir, 'skills_used.json'), 'utf-8')) as Array<{ name: string; pinned: boolean }>;
    expect(usage.filter((u) => u.pinned).map((u) => u.name)).toEqual(['fe-standards']);
    expect(usage.filter((u) => !u.pinned).map((u) => u.name)).toEqual(['api-standards', 'api-standards']);
  });
});
