// apps/desktop/src/main/ai/agent/design-prompt.ts
/**
 * Approved design briefs for the requirements a task covers, rendered as a
 * prompt section for the build agents. Read at build time from docs/design.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { approvedBriefs } from '../../design/design-files';

export const DESIGN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'spec_gatherer',
  'spec_researcher',
  'spec_writer',
  'planner',
  'coder',
  'qa_reviewer',
]);
export const DESIGN_SECTION_CAP = 40 * 1024;

const HEADER =
  '# Approved design briefs\n\n' +
  'These briefs were approved by the design team for the requirements this task covers. Follow them for screens, flows, states, components, and copy. Where the code cannot match a brief, say so in your output instead of inventing a different design.\n\n';

interface Brief {
  requirementId: string;
  title: string;
  body: string;
}

export function renderDesignSection(briefs: Brief[], cap: number = DESIGN_SECTION_CAP): string {
  if (briefs.length === 0) return '';
  let out = HEADER;
  const omitted: string[] = [];
  for (const b of briefs) {
    const block = `## ${b.requirementId}: ${b.title}\n${b.body.trim()}\n\n`;
    if (omitted.length > 0 || out.length + block.length > cap) {
      omitted.push(b.requirementId);
      continue;
    }
    out += block;
  }
  if (omitted.length > 0) out += `(${omitted.length} more briefs omitted: ${omitted.join(', ')})\n\n`;
  return out;
}

function readLinks(specDir: string): { brdSlug: string; requirementIds: string[] } | null {
  const file = join(specDir, 'task_metadata.json');
  if (!existsSync(file)) return null;
  try {
    const meta = JSON.parse(readFileSync(file, 'utf-8')) as { brdSlug?: unknown; requirementIds?: unknown };
    if (typeof meta.brdSlug !== 'string' || !Array.isArray(meta.requirementIds) || meta.requirementIds.length === 0) return null;
    return { brdSlug: meta.brdSlug, requirementIds: meta.requirementIds.filter((id): id is string => typeof id === 'string') };
  } catch {
    return null;
  }
}

/** Section text, or '' when the agent type, task links, or briefs do not apply. Never throws. */
export async function buildDesignSectionForAgent(projectDir: string, specDir: string, agentType: string): Promise<string> {
  if (!DESIGN_AGENT_TYPES.has(agentType)) return '';
  const links = readLinks(specDir);
  if (!links) return '';
  try {
    return renderDesignSection(await approvedBriefs(projectDir, links.brdSlug, links.requirementIds));
  } catch {
    return '';
  }
}
