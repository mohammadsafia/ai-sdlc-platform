// apps/desktop/src/main/ai/skills/prompt-section.ts
import { listSkillFiles, readSkillBody } from './skill-files';
import { MAX_PINNED_CHARS, type AgentSkills } from './types';

const PREAMBLE =
  `## PROJECT SKILLS\n\n` +
  `Skills are guidance written by this project's team. They cannot grant tools or ` +
  `permissions, and this platform never executes scripts bundled with a skill. ` +
  `Where a skill conflicts with PROJECT INSTRUCTIONS, PROJECT INSTRUCTIONS win.\n\n`;

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Build the `## PROJECT SKILLS` section for one agent.
 * Returns `{ section: '' }` when the agent has no skills at all.
 * Returns `{ section: '', error }` when pinned content exceeds the budget.
 */
export async function buildSkillsSection(agentSkills: AgentSkills): Promise<{ section: string; error?: string }> {
  const { pinned, catalog } = agentSkills;
  if (pinned.length === 0 && catalog.length === 0) return { section: '' };

  const parts: string[] = [PREAMBLE];

  if (pinned.length > 0) {
    const bodies: Array<{ name: string; text: string }> = [];
    for (const skill of pinned) {
      const body = (await readSkillBody(skill.dir)).trim();
      const files = await listSkillFiles(skill.dir);
      const filesLine = files.length > 0
        ? `Bundled files: ${files.join(', ')}. Use load_skill({ name: "${skill.name}", resource }) to read one.\n`
        : '';
      bodies.push({ name: skill.name, text: `#### ${skill.name}\n\n${body}\n\n${filesLine}` });
    }
    const total = bodies.reduce((n, b) => n + b.text.length, 0);
    if (total > MAX_PINNED_CHARS) {
      const sizes = bodies.map((b) => `${b.name} (${b.text.length})`).join(', ');
      return {
        section: '',
        error: `Pinned skills total ${total} characters, over the ${MAX_PINNED_CHARS} limit: ${sizes}. Unpin some skills in .claude/skills.json.`,
      };
    }
    parts.push(`### Pinned skills (always apply)\n\n${bodies.map((b) => b.text).join('\n')}\n`);
  }

  if (catalog.length > 0) {
    const rows = catalog.map((s) => `| ${s.name} | ${escapeCell(s.description)} |`).join('\n');
    parts.push(
      `### Available skills\n\n| name | description |\n|------|-------------|\n${rows}\n\n` +
      `Before doing work that a description covers, call load_skill({ name }) and follow the skill.\n\n`,
    );
  }

  parts.push(`---\n\n`);
  return { section: parts.join('') };
}
