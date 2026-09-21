// apps/desktop/src/main/ai/runners/design-writer.ts
/**
 * Design brief writer — drafts or revises one design brief as Markdown.
 * Streams text only; never writes files. Mirrors brd-writer.ts.
 */
import { streamText } from 'ai';

import type { DesignDraftMode } from '../../../shared/types/design';
import { loadTemplate } from '../../brd/templates';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { loadBrdProjectContext } from './brd-writer';

export interface DesignWriterRequirement {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  area: string;
}

export interface DesignWriterConfig {
  projectDir: string;
  mode: DesignDraftMode;
  notes: string;
  brdSlug: string;
  requirement: DesignWriterRequirement;
  siblingTitles: string[];
  brdBody: string;
  existing?: string;
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type DesignWriterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM = 'You write design briefs in Markdown following the TEMPLATE exactly. Output the document only.';

export function buildDesignWriterPrompts(
  config: DesignWriterConfig,
  template: string,
  projectContext: string,
): { system: string; prompt: string } {
  const rules = tryLoadPrompt('design_writer') ?? FALLBACK_SYSTEM;
  const system =
    `${rules.trim()}\n\n## TEMPLATE\n\n${template.trim()}\n` +
    (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');
  const r = config.requirement;
  const requirementBlock =
    `Requirement ${r.id}: ${r.title}\nArea: ${r.area}\n${r.description.trim()}\n\nAcceptance criteria:\n${r.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n` +
    `Other requirements in this BRD: ${config.siblingTitles.join('; ') || '(none)'}\n\n` +
    `Frontmatter values: title: ${r.title}, brd: ${config.brdSlug}, requirement: ${r.id}, updated: ${new Date().toISOString().slice(0, 10)}\n\n`;
  const prompt =
    config.mode === 'draft'
      ? `MODE: DRAFT\n\n${requirementBlock}BRD:\n${config.brdBody.trim()}\n\nDesigner notes:\n${config.notes.trim() || '(none)'}\n\nWrite the complete design brief now.`
      : `MODE: REVISE\n\n${requirementBlock}Current brief:\n\n${(config.existing ?? '').trim()}\n\nInstructions:\n${config.notes.trim()}\n\nReturn the complete revised brief now.`;
  return { system, prompt };
}

export async function runDesignWriter(config: DesignWriterConfig, onEvent: (e: DesignWriterEvent) => void): Promise<void> {
  let text = '';
  try {
    const { system, prompt } = buildDesignWriterPrompts(config, loadTemplate('design-brief-template'), loadBrdProjectContext(config.projectDir));
    const client = await createSimpleClient({
      systemPrompt: system,
      modelShorthand: config.modelShorthand ?? 'sonnet',
      thinkingLevel: config.thinkingLevel ?? 'medium',
      maxSteps: 1,
      tools: {},
    });
    const modelId = typeof client.model === 'string' ? client.model : client.model.modelId;
    const isCodex = modelId?.includes('codex') ?? false;
    const result = streamText({
      model: client.model,
      system: isCodex ? undefined : system,
      prompt,
      abortSignal: config.abortSignal,
      ...(isCodex ? { providerOptions: { openai: { instructions: system, store: false } } } : {}),
    });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        text += part.text;
        onEvent({ type: 'text-delta', text: part.text });
      } else if (part.type === 'error') {
        onEvent({ type: 'error', error: part.error instanceof Error ? part.error.message : String(part.error) });
        return;
      }
    }
    onEvent({ type: 'done', text });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
