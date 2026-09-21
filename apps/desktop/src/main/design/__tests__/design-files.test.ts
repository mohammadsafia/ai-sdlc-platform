import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

vi.mock('../../brd/templates', () => ({
  loadTemplate: () => '---\ntitle: <Title>\nbrd: <Brd>\nrequirement: <Requirement>\nstatus: draft\nupdated: <YYYY-MM-DD>\n---\n# <Title>\n\n## Summary\n',
}));

import { approvedBriefs, createDesignBrief, listDesignBriefs, readDesignBrief, setDesignBriefStatus, writeDesignBrief } from '../design-files';

let dir: string;
const brief = (status: string, title = 'Filter todos') =>
  `---\nbrd: todo-app\nrequirement: R3\ntitle: ${title}\nstatus: ${status}\nupdated: 2026-09-21\n---\n# ${title}\n\n## Summary\nBody text\n`;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'design-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('design files', () => {
  it('lists briefs across BRDs with status and warnings', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('approved'));
    writeFileSync(path.join(dir, 'docs/design/todo-app/R4.md'), '# no frontmatter');
    writeFileSync(path.join(dir, 'docs/design/todo-app/notes.md'), 'ignored');
    const list = await listDesignBriefs(dir);
    expect(list.map((b) => [b.brdSlug, b.requirementId, b.status, b.title])).toEqual([
      ['todo-app', 'R3', 'approved', 'Filter todos'],
      ['todo-app', 'R4', 'draft', 'R4'],
    ]);
    expect(list[1].warning).toContain('Frontmatter');
    expect(await listDesignBriefs(path.join(dir, 'nowhere'))).toEqual([]);
  });

  it('creates from the template, refuses duplicates, reads and writes', async () => {
    const s = await createDesignBrief(dir, 'todo-app', { id: 'R3', title: 'Filter todos' }, new Date('2026-09-21T10:00:00Z'));
    expect(s).toMatchObject({ brdSlug: 'todo-app', requirementId: 'R3', status: 'draft', title: 'Filter todos' });
    const file = readFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), 'utf-8');
    expect(file).toContain('title: Filter todos\nbrd: todo-app\nrequirement: R3\nstatus: draft\nupdated: 2026-09-21');
    await expect(createDesignBrief(dir, 'todo-app', { id: 'R3', title: 'x' })).rejects.toThrow('Design brief already exists: todo-app/R3');
    await writeDesignBrief(dir, 'todo-app', 'R3', brief('draft', 'Renamed'));
    expect((await readDesignBrief(dir, 'todo-app', 'R3')).summary.title).toBe('Renamed');
    await expect(readDesignBrief(dir, 'todo-app', 'R9')).rejects.toThrow('Design brief not found: todo-app/R9');
    await expect(readDesignBrief(dir, '../x', 'R1')).rejects.toThrow('Invalid BRD slug');
    await expect(readDesignBrief(dir, 'todo-app', 'x1')).rejects.toThrow('Invalid requirement id');
  });

  it('changes status by rewriting only the frontmatter lines', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('draft'));
    const s = await setDesignBriefStatus(dir, 'todo-app', 'R3', 'approved', new Date('2026-09-22T00:00:00Z'));
    expect(s.status).toBe('approved');
    const file = readFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), 'utf-8');
    expect(file).toContain('status: approved\nupdated: 2026-09-22\n');
    expect(file.split('---\n')[2]).toBe('# Filter todos\n\n## Summary\nBody text\n');
  });

  it('returns approved bodies in requirement order', async () => {
    mkdirSync(path.join(dir, 'docs/design/todo-app'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/design/todo-app/R3.md'), brief('approved'));
    writeFileSync(path.join(dir, 'docs/design/todo-app/R1.md'), brief('draft'));
    const out = await approvedBriefs(dir, 'todo-app', ['R9', 'R3', 'R1']);
    expect(out).toEqual([{ requirementId: 'R3', title: 'Filter todos', body: '# Filter todos\n\n## Summary\nBody text\n' }]);
    expect(existsSync(path.join(dir, 'docs/design/todo-app/R9.md'))).toBe(false);
  });
});
