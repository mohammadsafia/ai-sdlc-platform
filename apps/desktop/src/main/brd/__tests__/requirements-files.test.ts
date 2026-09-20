// apps/desktop/src/main/brd/__tests__/requirements-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { requirementsPath, readRequirements, writeRequirements, brdHash } from '../requirements-files';
import type { RequirementsSet } from '../../../shared/types/requirements';

const set: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

describe('requirements-files', () => {
  let projectDir: string;
  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'req-files-'));
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('requirementsPath validates the slug and stays under docs/brd', async () => {
    expect(await requirementsPath(projectDir, 'a')).toBe(path.join(realpathSync(projectDir), 'docs', 'brd', 'a.requirements.json'));
    await expect(requirementsPath(projectDir, '../x')).rejects.toThrow(/Invalid BRD slug/);
  });

  it('read returns null when missing, write round-trips atomically, invalid JSON reads as null', async () => {
    expect(await readRequirements(projectDir, 'a')).toBeNull();
    await writeRequirements(projectDir, 'a', set);
    expect(readdirSync(path.join(projectDir, 'docs', 'brd'))).toEqual(['a.requirements.json']);
    expect(await readRequirements(projectDir, 'a')).toEqual(set);
    writeFileSync(path.join(projectDir, 'docs', 'brd', 'b.requirements.json'), '{ nope');
    expect(await readRequirements(projectDir, 'b')).toBeNull();
  });

  it('read rejects a file that fails the schema', async () => {
    mkdirSync(path.join(projectDir, 'docs', 'brd'), { recursive: true });
    writeFileSync(path.join(projectDir, 'docs', 'brd', 'c.requirements.json'), JSON.stringify({ ...set, status: 'weird' }));
    await expect(readRequirements(projectDir, 'c')).rejects.toThrow(/invalid/i);
  });

  it('brdHash is stable sha256 hex', () => {
    expect(brdHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
