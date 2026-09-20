// apps/desktop/src/main/ai/runners/brd-writer.ts
/**
 * BRD writer — drafts or revises a Business Requirements Document as Markdown.
 * Streams text only; never writes files. Modeled on runners/insights.ts.
 */
import { streamText } from 'ai';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadTemplate } from '../../brd/templates';
import type { BrdDraftMode } from '../../../shared/types/brd';
import { safeParseJson } from '../../utils/json-repair';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';

export interface BrdWriterConfig {
  projectDir: string;
  mode: BrdDraftMode;
  notes: string;
  existing?: string;
  title?: string;
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type BrdWriterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM =
  'You write Business Requirements Documents in Markdown following the TEMPLATE exactly. Output the document only.';

interface ServiceLike { name?: string; language?: string; framework?: string }
interface ProjectIndexLike {
  project_root?: string;
  project_type?: string;
  /** Either a list of services or an object keyed by service name */
  services?: ServiceLike[] | Record<string, ServiceLike>;
}

/** Compact project summary from .auto-claude/project_index.json, or '' when absent. */
export function loadBrdProjectContext(projectDir: string): string {
  const indexPath = join(projectDir, '.auto-claude', 'project_index.json');
  if (!existsSync(indexPath)) return '';
  const parsed = safeParseJson<ProjectIndexLike>(readFileSync(indexPath, 'utf-8'));
  if (!parsed) return '';
  const lines: string[] = [];
  if (parsed.project_root) lines.push(`Project: ${parsed.project_root.split(/[\\/]/).pop()}`);
  if (parsed.project_type) lines.push(`Type: ${parsed.project_type}`);
  const rawServices = parsed.services ?? [];
  const serviceList: ServiceLike[] = Array.isArray(rawServices)
    ? rawServices
    : Object.entries(rawServices).map(([name, s]) => ({ name, ...(s ?? {}) }));
  const services = serviceList
    .map((s) => [s.name, s.language, s.framework].filter(Boolean).join(' / '))
    .filter(Boolean);
  if (services.length > 0) lines.push(`Services: ${services.join(', ')}`);
  return lines.join('\n');
}

export function buildBrdWriterPrompts(
  config: BrdWriterConfig,
  template: string,
  projectContext: string,
): { system: string; prompt: string } {
  const rules = tryLoadPrompt('brd_writer') ?? FALLBACK_SYSTEM;
  const system =
    `${rules.trim()}\n\n## TEMPLATE\n\n${template.trim()}\n` +
    (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');

  const prompt =
    config.mode === 'draft'
      ? `MODE: DRAFT\n\nTitle: ${config.title ?? 'Untitled'}\nCreated: ${new Date().toISOString().slice(0, 10)}\n\nProduct owner notes:\n${config.notes.trim()}\n\nWrite the complete BRD now.`
      : `MODE: REVISE\n\nCurrent document:\n\n${(config.existing ?? '').trim()}\n\nInstructions:\n${config.notes.trim()}\n\nReturn the complete revised BRD now.`;

  return { system, prompt };
}

export async function runBrdWriter(config: BrdWriterConfig, onEvent: (e: BrdWriterEvent) => void): Promise<void> {
  let text = '';
  try {
    const { system, prompt } = buildBrdWriterPrompts(config, loadTemplate('brd-template'), loadBrdProjectContext(config.projectDir));
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
        const error = part.error instanceof Error ? part.error.message : String(part.error);
        onEvent({ type: 'error', error });
        return;
      }
    }
    onEvent({ type: 'done', text });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}
