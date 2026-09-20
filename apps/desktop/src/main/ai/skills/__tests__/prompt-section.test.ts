// apps/desktop/src/main/ai/skills/__tests__/prompt-section.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildSkillsSection } from '../prompt-section';
import type { SkillDefinition } from '../types';

describe('buildSkillsSection', () => {
  let root: string;
  const mk = (name: string, body: string, files: Record<string, string> = {}): SkillDefinition => {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`);
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return { name, description: `${name} description`, source: 'local', dir };
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'skills-section-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty section when there are no skills', async () => {
    expect(await buildSkillsSection({ pinned: [], catalog: [] })).toEqual({ section: '' });
  });

  it('renders trust preamble, pinned bodies with file lists, and a catalog table', async () => {
    const pinned = mk('std', '# Standards\nUse tabs.\n', { 'references/a.md': 'x' });
    const cat = mk('other', '# Other\n');
    const { section, error } = await buildSkillsSection({ pinned: [pinned], catalog: [cat] });
    expect(error).toBeUndefined();
    expect(section).toContain('## PROJECT SKILLS');
    expect(section).toContain('cannot grant tools or permissions');
    expect(section).toContain('PROJECT INSTRUCTIONS win');
    expect(section).toContain('### Pinned skills (always apply)');
    expect(section).toContain('#### std');
    expect(section).toContain('Use tabs.');
    expect(section).toContain('Bundled files: references/a.md');
    expect(section).toContain('load_skill');
    expect(section).toContain('### Available skills');
    expect(section).toContain('| other | other description |');
    expect(section.endsWith('---\n\n')).toBe(true);
  });

  it('omits the pinned block when nothing is pinned and the catalog block when everything is pinned', async () => {
    const a = mk('a', 'A');
    const onlyCatalog = await buildSkillsSection({ pinned: [], catalog: [a] });
    expect(onlyCatalog.section).not.toContain('### Pinned skills');
    expect(onlyCatalog.section).toContain('### Available skills');
    const onlyPinned = await buildSkillsSection({ pinned: [a], catalog: [] });
    expect(onlyPinned.section).toContain('### Pinned skills');
    expect(onlyPinned.section).not.toContain('### Available skills');
  });

  it('escapes pipe characters in catalog descriptions', async () => {
    const s = mk('pipe', 'P');
    s.description = 'a | b';
    const { section } = await buildSkillsSection({ pinned: [], catalog: [s] });
    expect(section).toContain('| pipe | a \\| b |');
  });

  it('returns a blocking error when pinned content exceeds 40000 characters', async () => {
    const big1 = mk('big-one', 'x'.repeat(25_000));
    const big2 = mk('big-two', 'y'.repeat(25_000));
    const { section, error } = await buildSkillsSection({ pinned: [big1, big2], catalog: [] });
    expect(section).toBe('');
    expect(error).toContain('40000');
    expect(error).toContain('big-one');
    expect(error).toContain('big-two');
  });
});
