// apps/desktop/src/shared/design/structure.ts
import { parseFrontmatter } from '../frontmatter';
import type { BrdSection, BrdStructureResult } from '../types/brd';
import { DESIGN_BRIEF_STATUSES, type DesignBriefStatus, type DesignFrontmatter } from '../types/design';

export const DESIGN_REQUIRED_SECTIONS = ['Summary', 'User flows', 'Screens', 'Components'] as const;
export const DESIGN_OPTIONAL_SECTIONS = ['Copy', 'Accessibility', 'Open questions'] as const;

export function parseDesignFrontmatter(markdown: string): DesignFrontmatter {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { status: 'draft', errors: ['Frontmatter block is missing'] };
  const errors: string[] = [];
  const get = (k: string) => fm.fields[k]?.trim() || undefined;
  const rawStatus = get('status');
  let status: DesignBriefStatus = 'draft';
  if (rawStatus) {
    if ((DESIGN_BRIEF_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as DesignBriefStatus;
    else errors.push(`status must be one of ${DESIGN_BRIEF_STATUSES.join(', ')}`);
  }
  if (!get('title')) errors.push('title is required');
  return { brd: get('brd'), requirement: get('requirement'), title: get('title'), status, updated: get('updated'), errors };
}

function splitSections(markdown: string): Map<string, string[]> {
  const fm = parseFrontmatter(markdown);
  const body = fm ? fm.body : markdown;
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      current = [];
      sections.set(h2[1].toLowerCase(), current);
      continue;
    }
    current?.push(line);
  }
  return sections;
}

/** Whitespace, headings, bare list markers, template "Label:" lines, and <placeholders> count as empty. */
function isEmptyContent(lines: string[]): boolean {
  return lines.every((raw) => {
    const line = raw.replace(/<[^>]*>/g, '').trim();
    if (line === '') return true;
    if (/^#+(\s|$)/.test(line)) return true;
    if (/^(\d+\.|[-*+])\s*$/.test(line)) return true;
    if (/^(Layout|States|Interactions):\s*(empty, loading, error, success)?$/.test(line)) return true;
    return false;
  });
}

export function checkDesignStructure(markdown: string): BrdStructureResult {
  const frontmatterErrors = parseDesignFrontmatter(markdown).errors;
  const found = splitSections(markdown);
  const describe = (heading: string, required: boolean): BrdSection => {
    const lines = found.get(heading.toLowerCase());
    const present = lines !== undefined;
    return { heading, required, present, empty: !present || isEmptyContent(lines) };
  };
  const sections = [
    ...DESIGN_REQUIRED_SECTIONS.map((h) => describe(h, true)),
    ...DESIGN_OPTIONAL_SECTIONS.map((h) => describe(h, false)),
  ];
  const ok = frontmatterErrors.length === 0 && sections.every((s) => !s.required || (s.present && !s.empty));
  return { ok, sections, frontmatterErrors };
}
