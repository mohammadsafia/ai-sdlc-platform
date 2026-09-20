// apps/desktop/src/main/ai/config/__tests__/agent-configs-skills.test.ts
import { describe, it, expect } from 'vitest';
import { AGENT_CONFIGS } from '../agent-configs';

describe('agent configs — load_skill availability', () => {
  it('every agent with Read also has load_skill, and no agent without Read has it', () => {
    for (const [agentType, config] of Object.entries(AGENT_CONFIGS)) {
      const tools = config.tools as readonly string[];
      const hasRead = tools.includes('Read');
      const hasLoadSkill = tools.includes('load_skill');
      expect({ agentType, hasLoadSkill }).toEqual({ agentType, hasLoadSkill: hasRead });
    }
  });

  it('tool-less agents stay tool-less', () => {
    expect(AGENT_CONFIGS.merge_resolver.tools).toEqual([]);
    expect(AGENT_CONFIGS.commit_message.tools).toEqual([]);
  });
});
