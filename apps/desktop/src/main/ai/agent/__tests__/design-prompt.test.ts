import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { approvedBriefs } = vi.hoisted(() => ({ approvedBriefs: vi.fn() }));
vi.mock('../../../design/design-files', () => ({ approvedBriefs }));

import { DESIGN_SECTION_CAP, buildDesignSectionForAgent, renderDesignSection } from '../design-prompt';

let specDir: string;
beforeEach(() => {
  vi.clearAllMocks();
  specDir = mkdtempSync(path.join(tmpdir(), 'spec-'));
});
afterEach(() => rmSync(specDir, { recursive: true, force: true }));

const meta = (m: object) => writeFileSync(path.join(specDir, 'task_metadata.json'), JSON.stringify(m));

describe('buildDesignSectionForAgent', () => {
  it('returns empty without metadata, without requirement links, or for other agent types', async () => {
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    meta({ brdSlug: 'todo-app' });
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    meta({ brdSlug: 'todo-app', requirementIds: ['R3'] });
    expect(await buildDesignSectionForAgent('/p', specDir, 'complexity_assessor')).toBe('');
    expect(approvedBriefs).not.toHaveBeenCalled();
  });

  it('renders approved briefs for build agents and swallows read errors', async () => {
    meta({ brdSlug: 'todo-app', requirementIds: ['R3', 'R4'] });
    approvedBriefs.mockResolvedValue([{ requirementId: 'R3', title: 'Filter todos', body: '# Filter todos\n\n## Summary\nText\n' }]);
    const section = await buildDesignSectionForAgent('/p', specDir, 'planner');
    expect(approvedBriefs).toHaveBeenCalledWith('/p', 'todo-app', ['R3', 'R4']);
    expect(section).toContain('# Approved design briefs');
    expect(section).toContain('## R3: Filter todos\n# Filter todos\n\n## Summary\nText');
    approvedBriefs.mockRejectedValue(new Error('disk'));
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
    approvedBriefs.mockResolvedValue([]);
    expect(await buildDesignSectionForAgent('/p', specDir, 'coder')).toBe('');
  });
});

describe('renderDesignSection', () => {
  it('caps the total size and lists omitted briefs', () => {
    const big = 'x'.repeat(DESIGN_SECTION_CAP);
    const out = renderDesignSection(
      [
        { requirementId: 'R1', title: 'A', body: 'small' },
        { requirementId: 'R2', title: 'B', body: big },
        { requirementId: 'R3', title: 'C', body: 'small' },
      ],
      DESIGN_SECTION_CAP,
    );
    expect(out).toContain('## R1: A');
    expect(out).not.toContain('## R2: B');
    expect(out).toContain('(2 more briefs omitted: R2, R3)');
    expect(out.length).toBeLessThan(DESIGN_SECTION_CAP);
  });
});
