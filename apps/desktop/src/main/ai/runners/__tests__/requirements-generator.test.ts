// apps/desktop/src/main/ai/runners/__tests__/requirements-generator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateText, createSimpleClient } = vi.hoisted(() => ({ generateText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ generateText, Output: { object: ({ schema }: { schema: unknown }) => ({ kind: 'object', schema }) } }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'RULES' }));
vi.mock('../brd-writer', () => ({ loadBrdProjectContext: () => 'Project: Acme' }));

import { buildRequirementsPrompts, runRequirementsGenerator } from '../requirements-generator';
import type { RequirementsSet } from '../../../../shared/types/requirements';

const validBody = {
  requirements: [{ title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false }],
  milestones: [{ name: 'm', description: 'd', order: 1 }],
  tasks: [{ title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1 }],
};
/** What the runner emits: missing ids and changeSummary are defaulted to null before validation. */
const normalizedBody = {
  requirements: validBody.requirements.map((r) => ({ ...r, id: null })),
  milestones: validBody.milestones.map((m) => ({ ...m, id: null })),
  tasks: validBody.tasks.map((t) => ({ ...t, id: null })),
  changeSummary: null,
};
const previous: RequirementsSet = {
  version: 1, brdSlug: 'a', brdHash: 'h', status: 'draft', generatedAt: 't',
  requirements: [{ id: 'R1', title: 'r', description: 'd', acceptanceCriteria: ['x'], area: 'A', needsDesign: false, included: true }],
  milestones: [{ id: 'M1', name: 'm', description: 'd', order: 1, included: true }],
  tasks: [{ id: 'T1', title: 't', description: 'd', milestoneId: 'M1', requirementIds: ['R1'], category: 'feature', order: 1, included: true }],
};

describe('buildRequirementsPrompts', () => {
  it('generate mode includes rules, context, and the BRD', () => {
    const { system, prompt } = buildRequirementsPrompts({ projectDir: '/p', mode: 'generate', brdMarkdown: '# BRD BODY' }, 'Project: Acme');
    expect(system).toContain('RULES');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: GENERATE');
    expect(prompt).toContain('## BRD\n\n# BRD BODY');
  });
  it('refine mode includes current set, feedback, and selection', () => {
    const { prompt } = buildRequirementsPrompts(
      { projectDir: '/p', mode: 'refine', brdMarkdown: '# B', previous, feedback: 'Split R1', selection: ['R1', 'T1'] },
      '',
    );
    expect(prompt).toContain('MODE: REFINE');
    expect(prompt).toContain('## CURRENT SET');
    expect(prompt).toContain('"id": "R1"');
    expect(prompt).toContain('## FEEDBACK\n\nSplit R1');
    expect(prompt).toContain('## SELECTION\n\nR1, T1');
    expect(prompt).toContain('change only');
  });
});

describe('runRequirementsGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude-sonnet' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
  });

  it('uses Output.object output when present', async () => {
    generateText.mockResolvedValue({ output: validBody, text: '' });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events[0]).toEqual({ type: 'progress', phase: 'started' });
    expect(events.at(-1)).toEqual({ type: 'done', body: normalizedBody });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(generateText.mock.calls[0][0]).toMatchObject({ output: { kind: 'object' } });
  });

  it('falls back to parsing the text when output is missing', async () => {
    generateText.mockResolvedValue({ output: undefined, text: `Here you go:\n\`\`\`json\n${JSON.stringify(validBody)}\n\`\`\`` });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events).toContainEqual({ type: 'progress', phase: 'parsing' });
    expect(events.at(-1)).toEqual({ type: 'done', body: normalizedBody });
  });

  it('retries once with validation errors, then errors out', async () => {
    generateText
      .mockResolvedValueOnce({ output: undefined, text: '{"requirements": "nope"}' })
      .mockResolvedValueOnce({ output: undefined, text: 'still bad' });
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events).toContainEqual({ type: 'progress', phase: 'repairing' });
    expect(generateText).toHaveBeenCalledTimes(2);
    const retryPrompt = (generateText.mock.calls[1][0] as { prompt: string }).prompt;
    expect(retryPrompt).toContain('STRUCTURED OUTPUT VALIDATION ERRORS');
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('reports thrown errors', async () => {
    generateText.mockRejectedValue(new Error('no model'));
    const events: unknown[] = [];
    await runRequirementsGenerator({ projectDir: '/p', mode: 'generate', brdMarkdown: '#' }, (e) => events.push(e));
    expect(events.at(-1)).toEqual({ type: 'error', error: 'no model' });
  });
});
