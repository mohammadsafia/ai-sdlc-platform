// apps/desktop/src/main/ai/runners/__tests__/brd-writer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const { streamText, createSimpleClient } = vi.hoisted(() => ({ streamText: vi.fn(), createSimpleClient: vi.fn() }));
vi.mock('ai', () => ({ streamText }));
vi.mock('../../client/factory', () => ({ createSimpleClient }));
vi.mock('../../prompts/prompt-loader', () => ({ tryLoadPrompt: () => 'SYSTEM RULES' }));
vi.mock('../../../brd/templates', () => ({ loadTemplate: () => '---\ntitle: <Title>\n---\n## Summary\n' }));

import { buildBrdWriterPrompts, loadBrdProjectContext, runBrdWriter } from '../brd-writer';

async function* parts(items: Array<Record<string, unknown>>) {
  for (const p of items) yield p;
}

describe('buildBrdWriterPrompts', () => {
  it('draft mode embeds template, context, title, and notes', () => {
    const { system, prompt } = buildBrdWriterPrompts(
      { projectDir: '/p', mode: 'draft', notes: 'Users churn.', title: 'Onboarding' },
      'TEMPLATE BODY',
      'Project: Acme',
    );
    expect(system).toContain('SYSTEM RULES');
    expect(system).toContain('## TEMPLATE\n\nTEMPLATE BODY');
    expect(system).toContain('## PROJECT CONTEXT\n\nProject: Acme');
    expect(prompt).toContain('MODE: DRAFT');
    expect(prompt).toContain('Title: Onboarding');
    expect(prompt).toContain('Users churn.');
  });

  it('revise mode includes the existing document and instructions', () => {
    const { prompt } = buildBrdWriterPrompts(
      { projectDir: '/p', mode: 'revise', notes: 'Split milestone 2.', existing: '# Doc' },
      'T',
      '',
    );
    expect(prompt).toContain('MODE: REVISE');
    expect(prompt).toContain('# Doc');
    expect(prompt).toContain('Split milestone 2.');
  });
});

describe('loadBrdProjectContext', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'brd-ctx-'));
  });
  it('summarizes project_index.json when present and is empty otherwise', () => {
    expect(loadBrdProjectContext(dir)).toBe('');
    mkdirSync(path.join(dir, '.auto-claude'), { recursive: true });
    writeFileSync(
      path.join(dir, '.auto-claude', 'project_index.json'),
      JSON.stringify({ project_root: '/x/acme', project_type: 'web', services: [{ name: 'api', language: 'ts' }, { name: 'web', language: 'ts' }] }),
    );
    const ctx = loadBrdProjectContext(dir);
    expect(ctx).toContain('acme');
    expect(ctx).toContain('web');
    expect(ctx).toContain('api');
    writeFileSync(
      path.join(dir, '.auto-claude', 'project_index.json'),
      JSON.stringify({ project_root: '/x/acme', services: { api: { language: 'ts' }, worker: { language: 'py' } } }),
    );
    const objCtx = loadBrdProjectContext(dir);
    expect(objCtx).toContain('api / ts');
    expect(objCtx).toContain('worker / py');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('runBrdWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSimpleClient.mockResolvedValue({ model: { modelId: 'claude-sonnet' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
  });

  it('streams deltas then emits done with the full text', async () => {
    streamText.mockReturnValue({ fullStream: parts([{ type: 'text-delta', text: 'Hel' }, { type: 'text-delta', text: 'lo' }]) });
    const events: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n', title: 't' }, (e) => events.push(e));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'done', text: 'Hello' },
    ]);
    expect(createSimpleClient).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 1, tools: {} }));
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ system: expect.stringContaining('SYSTEM RULES') }));
  });

  it('emits error on a stream error part and on a thrown error', async () => {
    streamText.mockReturnValue({ fullStream: parts([{ type: 'error', error: new Error('boom') }]) });
    const events: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, (e) => events.push(e));
    expect(events).toEqual([{ type: 'error', error: 'boom' }]);

    streamText.mockImplementation(() => { throw new Error('no model'); });
    const events2: unknown[] = [];
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, (e) => events2.push(e));
    expect(events2).toEqual([{ type: 'error', error: 'no model' }]);
  });

  it('uses provider instructions instead of system for codex models', async () => {
    createSimpleClient.mockResolvedValue({ model: { modelId: 'gpt-5-codex' }, systemPrompt: 'S', tools: {}, maxSteps: 1 });
    streamText.mockReturnValue({ fullStream: parts([]) });
    await runBrdWriter({ projectDir: '/p', mode: 'draft', notes: 'n' }, () => {});
    const call = streamText.mock.calls[0][0] as { system?: string; providerOptions?: { openai?: { instructions?: string } } };
    expect(call.system).toBeUndefined();
    expect(call.providerOptions?.openai?.instructions).toContain('SYSTEM RULES');
  });
});
