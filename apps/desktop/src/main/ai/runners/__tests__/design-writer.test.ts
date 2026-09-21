import { describe, it, expect, vi, beforeEach } from 'vitest';

const { streamText, createSimpleClient } = vi.hoisted(() => ({ streamText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ streamText }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'DESIGN RULES' }));
vi.mock('../../../brd/templates', () => ({ loadTemplate: () => '---\ntitle: <Title>\n---\n## Summary\n' }));
vi.mock('../brd-writer', () => ({ loadBrdProjectContext: () => 'Project: Acme' }));

import { buildDesignWriterPrompts, runDesignWriter } from '../design-writer';

const cfg = {
  projectDir: '/p',
  mode: 'draft' as const,
  notes: 'Keep it minimal.',
  brdSlug: 'todo-app',
  requirement: { id: 'R3', title: 'Filter todos', description: 'Filter by status', acceptanceCriteria: ['Shows all', 'Shows done'], area: 'List' },
  siblingTitles: ['Add todo', 'Delete todo'],
  brdBody: '# Todo app\nBody',
};

async function* parts(items: Array<Record<string, unknown>>) {
  for (const p of items) yield p;
}

beforeEach(() => vi.clearAllMocks());

describe('buildDesignWriterPrompts', () => {
  it('draft mode embeds rules, template, context, requirement, siblings, BRD, and notes', () => {
    const { system, prompt } = buildDesignWriterPrompts(cfg, 'TEMPLATE BODY', 'Project: Acme');
    expect(system).toContain('DESIGN RULES');
    expect(system).toContain('## TEMPLATE\n\nTEMPLATE BODY');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: DRAFT');
    expect(prompt).toContain('Requirement R3: Filter todos');
    expect(prompt).toContain('- Shows all\n- Shows done');
    expect(prompt).toContain('Other requirements in this BRD: Add todo; Delete todo');
    expect(prompt).toContain('BRD:\n# Todo app\nBody');
    expect(prompt).toContain('Designer notes:\nKeep it minimal.');
    expect(prompt).toContain('brd: todo-app');
  });

  it('revise mode includes the existing brief and instructions', () => {
    const { prompt } = buildDesignWriterPrompts({ ...cfg, mode: 'revise', existing: '# Old', notes: 'Add an empty state.' }, 'T', '');
    expect(prompt).toContain('MODE: REVISE');
    expect(prompt).toContain('Current brief:\n\n# Old');
    expect(prompt).toContain('Instructions:\nAdd an empty state.');
  });
});

describe('runDesignWriter', () => {
  it('streams deltas then done', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude' }, systemPrompt: 's' });
    streamText.mockReturnValue({ fullStream: parts([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }]) });
    const events: unknown[] = [];
    await runDesignWriter(cfg, (e) => events.push(e));
    expect(events).toEqual([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }, { type: 'done', text: 'ab' }]);
  });

  it('reports stream errors and thrown errors', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude' }, systemPrompt: 's' });
    streamText.mockReturnValue({ fullStream: parts([{ type: 'error', error: new Error('boom') }]) });
    const events: unknown[] = [];
    await runDesignWriter(cfg, (e) => events.push(e));
    expect(events).toEqual([{ type: 'error', error: 'boom' }]);
    createSimpleClient.mockRejectedValue(new Error('no model'));
    const events2: unknown[] = [];
    await runDesignWriter(cfg, (e) => events2.push(e));
    expect(events2).toEqual([{ type: 'error', error: 'no model' }]);
  });
});
