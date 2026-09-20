// apps/desktop/src/main/brd/__tests__/brd-files.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, symlinkSync, existsSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { brdPath, listBrds, readBrd, writeBrd, createBrd } from '../brd-files';

const doc = (title: string, extra = '') => `---\ntitle: ${title}\nstatus: review\ncreated: 2026-09-01\n---\n# ${title}\n\n## Summary\n\nText.\n${extra}`;

describe('brd-files', () => {
  let projectDir: string;
  let brdDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(path.join(tmpdir(), 'brd-files-'));
    brdDir = path.join(projectDir, 'docs', 'brd');
  });
  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('brdPath validates the slug and stays inside docs/brd', async () => {
    expect(await brdPath(projectDir, 'my-brd')).toBe(path.join(realpathSync(projectDir), 'docs', 'brd', 'my-brd.md'));
    await expect(brdPath(projectDir, '../x')).rejects.toThrow(/Invalid BRD slug/);
    await expect(brdPath(projectDir, 'Upper')).rejects.toThrow(/Invalid BRD slug/);
    await expect(brdPath(projectDir, '')).rejects.toThrow(/Invalid BRD slug/);
  });

  it('brdPath rejects a symlinked docs/brd that escapes the project', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'brd-outside-'));
    mkdirSync(path.join(projectDir, 'docs'), { recursive: true });
    symlinkSync(outside, brdDir, 'dir');
    await expect(brdPath(projectDir, 'x')).rejects.toThrow(/outside the project/);
    rmSync(outside, { recursive: true, force: true });
  });

  it('listBrds returns an empty list when the folder is missing', async () => {
    expect(await listBrds(projectDir)).toEqual([]);
  });

  it('listBrds reads frontmatter, warns on missing title, ignores non-md, sorts by modifiedAt desc', async () => {
    mkdirSync(brdDir, { recursive: true });
    writeFileSync(path.join(brdDir, 'older.md'), doc('Older'));
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(path.join(brdDir, 'notes.txt'), 'ignored');
    writeFileSync(path.join(brdDir, 'untitled.md'), '# no frontmatter');
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(path.join(brdDir, 'newer.md'), doc('Newer'));
    const list = await listBrds(projectDir);
    expect(list.map((b) => b.slug)).toEqual(['newer', 'untitled', 'older']);
    expect(list[0]).toMatchObject({ title: 'Newer', status: 'review', created: '2026-09-01' });
    expect(list[1]).toMatchObject({ title: 'untitled', warning: expect.stringContaining('Frontmatter') });
  });

  it('readBrd returns summary and content; missing file errors', async () => {
    mkdirSync(brdDir, { recursive: true });
    writeFileSync(path.join(brdDir, 'a.md'), doc('A'));
    const r = await readBrd(projectDir, 'a');
    expect(r.summary.title).toBe('A');
    expect(r.content).toContain('## Summary');
    await expect(readBrd(projectDir, 'missing')).rejects.toThrow(/not found/);
  });

  it('writeBrd creates the folder, writes atomically, and returns the new summary', async () => {
    const s = await writeBrd(projectDir, 'b', doc('B'));
    expect(s).toMatchObject({ slug: 'b', title: 'B' });
    expect(readdirSync(brdDir)).toEqual(['b.md']); // no temp file left behind
  });

  it('createBrd renders the template, derives the slug, and suffixes on collision', async () => {
    const first = await createBrd(projectDir, 'Customer Onboarding', new Date('2026-09-20T10:00:00Z'));
    expect(first).toMatchObject({ slug: 'customer-onboarding', title: 'Customer Onboarding', status: 'draft', created: '2026-09-20' });
    const second = await createBrd(projectDir, 'Customer Onboarding', new Date('2026-09-20T10:00:00Z'));
    expect(second.slug).toBe('customer-onboarding-2');
    expect(existsSync(path.join(brdDir, 'customer-onboarding-2.md'))).toBe(true);
    const content = (await readBrd(projectDir, 'customer-onboarding')).content;
    expect(content).toContain('title: Customer Onboarding');
    expect(content).toContain('created: 2026-09-20');
  });
});
