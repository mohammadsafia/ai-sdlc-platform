// apps/desktop/src/main/ai/agent/skills-prompt.ts
import { AGENT_CONFIGS } from '../config/agent-configs';
import { buildSkillsSection } from '../skills/prompt-section';
import { getSkillsForAgent } from '../skills/resolver';
import { appendSkillUsage } from '../skills/skill-files';
import type { SkillsSnapshot } from '../skills/types';

/** The agent identity used for pins: explicit > prompt name if it is an agent type > session agent type. */
export function resolveEffectiveAgentType(promptName: string, sessionAgentType: string, explicit?: string): string {
  if (explicit) return explicit;
  if (promptName in AGENT_CONFIGS) return promptName;
  return sessionAgentType;
}

/**
 * Build the PROJECT SKILLS section for one agent and record pinned skills in
 * `<specDir>/skills_used.json`. Throws when the pinned budget is exceeded.
 */
export async function buildSkillsSectionForAgent(
  snapshot: SkillsSnapshot | undefined,
  agentType: string,
  specDir: string,
): Promise<string> {
  if (!snapshot) return '';
  const agentSkills = getSkillsForAgent(snapshot, agentType);
  const { section, error } = await buildSkillsSection(agentSkills);
  if (error) throw new Error(error);
  const at = new Date().toISOString();
  for (const skill of agentSkills.pinned) {
    await appendSkillUsage(specDir, { name: skill.name, agentType, pinned: true, at });
  }
  return section;
}
