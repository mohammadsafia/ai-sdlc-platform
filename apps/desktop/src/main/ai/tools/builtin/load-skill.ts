// apps/desktop/src/main/ai/tools/builtin/load-skill.ts
/**
 * load_skill — read a project skill (SKILL.md body + bundled file list),
 * or one bundled file. This is the ONLY way agents reach skill folders that
 * live outside the project directory; Read/Glob/Grep stay project-contained.
 */
import { z } from 'zod/v3';

import { effectiveSkills, findSkill } from '../../skills/resolver';
import { appendSkillUsage, listSkillFiles, readSkillBody, readSkillResource } from '../../skills/skill-files';
import { Tool } from '../define';
import { DEFAULT_EXECUTION_OPTIONS, ToolPermission } from '../types';

const inputSchema = z.object({
  name: z.string().describe('Skill name exactly as listed under PROJECT SKILLS'),
  resource: z
    .string()
    .optional()
    .describe('Optional path of a bundled file relative to the skill folder, e.g. "references/guide.md"'),
});

export const loadSkillTool = Tool.define({
  metadata: {
    name: 'load_skill',
    description:
      'Load a project skill by name. Without "resource", returns the skill instructions and the list of bundled files. With "resource", returns that bundled file. Skills are listed in the PROJECT SKILLS section of your instructions.',
    permission: ToolPermission.ReadOnly,
    executionOptions: DEFAULT_EXECUTION_OPTIONS,
  },
  inputSchema,
  execute: async (input, context): Promise<string> => {
    const snapshot = context.skillsSnapshot;
    if (!snapshot || effectiveSkills(snapshot).length === 0) {
      return 'Error: No project skills are configured for this project.';
    }

    const skill = findSkill(snapshot, input.name);
    if (!skill) {
      const valid = effectiveSkills(snapshot).map((s) => s.name).join(', ');
      return `Error: Unknown skill "${input.name}". Valid names: ${valid}`;
    }

    const record = {
      name: skill.name,
      ...(input.resource ? { resource: input.resource } : {}),
      agentType: context.agentType ?? 'unknown',
      pinned: false,
      at: new Date().toISOString(),
    };

    try {
      if (input.resource) {
        const content = await readSkillResource(skill.dir, input.resource);
        await appendSkillUsage(context.specDir, record);
        return content;
      }
      const body = await readSkillBody(skill.dir);
      const files = await listSkillFiles(skill.dir);
      await appendSkillUsage(context.specDir, record);
      const filesBlock = files.length > 0
        ? `\n\nBundled files: ${files.join(', ')}\nCall load_skill({ name: "${skill.name}", resource: "<path>" }) to read one.`
        : '';
      return `${body.trim()}${filesBlock}`;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error: ${message}`;
    }
  },
});
