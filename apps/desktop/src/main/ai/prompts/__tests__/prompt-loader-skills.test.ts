// apps/desktop/src/main/ai/prompts/__tests__/prompt-loader-skills.test.ts
import { describe, it, expect } from 'vitest';
import { injectContext } from '../prompt-loader';

describe('injectContext skills section', () => {
  it('inserts the skills section after project instructions and before the base prompt', () => {
    const out = injectContext('BASE', {
      specDir: '/p/.auto-claude/specs/001',
      projectDir: '/p',
      projectInstructions: 'INSTR',
      skillsSection: '## PROJECT SKILLS\n\nSKILLS\n\n---\n\n',
    });
    const instr = out.indexOf('## PROJECT INSTRUCTIONS');
    const skills = out.indexOf('## PROJECT SKILLS');
    const base = out.indexOf('BASE');
    expect(instr).toBeGreaterThan(-1);
    expect(skills).toBeGreaterThan(instr);
    expect(base).toBeGreaterThan(skills);
  });

  it('omits the section when skillsSection is empty or absent', () => {
    expect(injectContext('BASE', { specDir: '/s', projectDir: '/p', skillsSection: '' })).not.toContain('PROJECT SKILLS');
    expect(injectContext('BASE', { specDir: '/s', projectDir: '/p' })).not.toContain('PROJECT SKILLS');
  });
});
