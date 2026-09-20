// apps/desktop/src/shared/brd/structure.ts
import { parseFrontmatter } from '../frontmatter';
import { BRD_STATUSES, type BrdFrontmatter, type BrdSection, type BrdStatus, type BrdStructureResult } from '../types/brd';

export const BRD_REQUIRED_SECTIONS = [
  'Summary',
  'Problem and goals',
  'Scope',
  'Functional requirements',
  'Milestones',
] as const;

export const BRD_OPTIONAL_SECTIONS = [
  'Success metrics',
  'Users and stakeholders',
  'Non-functional requirements',
  'Constraints and assumptions',
  'Open questions',
] as const;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'brd';
}

export function parseBrdFrontmatter(markdown: string): BrdFrontmatter {
  const fm = parseFrontmatter(markdown);
  if (!fm) return { status: 'draft', errors: ['Frontmatter block is missing'] };
  const errors: string[] = [];
  const title = fm.fields.title?.trim() || undefined;
  const created = fm.fields.created?.trim() || undefined;
  const owner = fm.fields.owner?.trim() || undefined;
  const rawStatus = fm.fields.status?.trim();
  if (!title) errors.push('title is required');
  if (!created) errors.push('created is required');
  let status: BrdStatus = 'draft';
  if (rawStatus) {
    if ((BRD_STATUSES as readonly string[]).includes(rawStatus)) status = rawStatus as BrdStatus;
    else errors.push(`status must be one of ${BRD_STATUSES.join(', ')}`);
  }
  return { title, status, owner, created, errors };
}

/** Body text (after frontmatter) split into level-2 sections. */
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

/** True when the lines hold nothing but whitespace, headings, list markers, or <placeholders>. */
function isEmptyContent(lines: string[]): boolean {
  return lines.every((raw) => {
    const line = raw.replace(/<[^>]*>/g, '').trim();
    if (line === '') return true;
    if (/^#+\s/.test(line) || /^#+$/.test(line)) return true;
    if (/^(\d+\.|[-*+])\s*$/.test(line)) return true;
    return false;
  });
}

export function checkBrdStructure(markdown: string): BrdStructureResult {
  const frontmatterErrors = parseBrdFrontmatter(markdown).errors;
  const found = splitSections(markdown);
  const describe = (heading: string, required: boolean): BrdSection => {
    const lines = found.get(heading.toLowerCase());
    const present = lines !== undefined;
    const empty = !present || isEmptyContent(lines);
    return { heading, required, present, empty };
  };
  const sections = [
    ...BRD_REQUIRED_SECTIONS.map((h) => describe(h, true)),
    ...BRD_OPTIONAL_SECTIONS.map((h) => describe(h, false)),
  ];
  const ok = frontmatterErrors.length === 0 && sections.every((s) => !s.required || (s.present && !s.empty));
  return { ok, sections, frontmatterErrors };
}
