// apps/desktop/src/main/ai/runners/requirements-generator.ts
/**
 * Requirements generator — turns a BRD into a structured requirements set
 * (generate) or revises an existing set from feedback (refine).
 * Structured output via Output.object with parseLLMJson fallback and one
 * validation retry. Never writes files.
 */
import { generateText, Output } from 'ai';

import { GeneratedBodySchema } from '../../../shared/brd/requirements';
import type { GeneratedBody, RequirementsRunMode, RequirementsRunPhase, RequirementsSet } from '../../../shared/types/requirements';
import { createSimpleClient } from '../client/factory';
import type { ThinkingLevel } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { buildValidationRetryPrompt, formatZodErrors, parseLLMJson } from '../schema/structured-output';
import { loadBrdProjectContext } from './brd-writer';

export interface RequirementsRunConfig {
  projectDir: string;
  mode: RequirementsRunMode;
  brdMarkdown: string;
  previous?: RequirementsSet;
  feedback?: string;
  selection?: string[];
  modelShorthand?: string;
  thinkingLevel?: ThinkingLevel;
  abortSignal?: AbortSignal;
}

export type RequirementsRunEvent =
  | { type: 'progress'; phase: RequirementsRunPhase }
  | { type: 'done'; body: GeneratedBody }
  | { type: 'error'; error: string };

const FALLBACK_SYSTEM = 'You turn a BRD into a JSON requirements set with requirements, milestones, and tasks. Output JSON only.';

function stripMeta(set: RequirementsSet): GeneratedBody {
  return {
    requirements: set.requirements.map(({ included: _i, ...r }) => r),
    milestones: set.milestones.map(({ included: _i, ...m }) => m),
    tasks: set.tasks.map(({ included: _i, ...t }) => t),
  };
}

export function buildRequirementsPrompts(config: RequirementsRunConfig, projectContext: string): { system: string; prompt: string } {
  const rules = tryLoadPrompt('requirements_generator') ?? FALLBACK_SYSTEM;
  const system = `${rules.trim()}\n` + (projectContext ? `\n## PROJECT CONTEXT\n\n${projectContext.trim()}\n` : '');

  const parts: string[] = [];
  if (config.mode === 'generate') {
    parts.push('MODE: GENERATE', '', '## BRD', '', config.brdMarkdown.trim(), '', 'Produce the complete requirements set as JSON now.');
  } else {
    parts.push('MODE: REFINE', '', '## BRD', '', config.brdMarkdown.trim(), '', '## CURRENT SET', '', JSON.stringify(config.previous ? stripMeta(config.previous) : {}, null, 2));
    parts.push('', '## FEEDBACK', '', (config.feedback ?? '').trim());
    if (config.selection && config.selection.length > 0) {
      parts.push('', '## SELECTION', '', config.selection.join(', '), '', 'Apply the feedback and change only the items listed in SELECTION. Echo every other item unchanged with its id. New items may be added without ids.');
    } else {
      parts.push('', 'Apply the feedback to the whole set. Keep the ids of items you keep.');
    }
    parts.push('', 'Return the complete revised set as JSON with a changeSummary.');
  }
  return { system, prompt: parts.join('\n') };
}

export async function runRequirementsGenerator(
  config: RequirementsRunConfig,
  onEvent: (e: RequirementsRunEvent) => void,
): Promise<void> {
  onEvent({ type: 'progress', phase: 'started' });
  try {
    const { system, prompt } = buildRequirementsPrompts(config, loadBrdProjectContext(config.projectDir));
    const client = await createSimpleClient({
      systemPrompt: system,
      modelShorthand: config.modelShorthand ?? 'sonnet',
      thinkingLevel: config.thinkingLevel ?? 'medium',
      maxSteps: 1,
      tools: {},
    });

    const call = async (userPrompt: string) => {
      const result = await generateText({
        model: client.model,
        system,
        prompt: userPrompt,
        abortSignal: config.abortSignal,
        output: Output.object({ schema: GeneratedBodySchema }),
      });
      // biome-ignore lint/suspicious/noExplicitAny: result.output type varies with the OUTPUT generic
      const anyResult = result as any;
      const direct = anyResult.output != null ? GeneratedBodySchema.safeParse(anyResult.output) : null;
      if (direct?.success) return { body: direct.data as GeneratedBody, text: String(anyResult.text ?? '') };
      onEvent({ type: 'progress', phase: 'parsing' });
      const text = String(anyResult.text ?? '');
      const parsed = parseLLMJson(text, GeneratedBodySchema);
      return { body: parsed ? (parsed as GeneratedBody) : null, text };
    };

    const first = await call(prompt);
    if (first.body) {
      onEvent({ type: 'done', body: first.body });
      return;
    }

    onEvent({ type: 'progress', phase: 'repairing' });
    const validation = GeneratedBodySchema.safeParse(safeJson(first.text));
    const errors = validation.success ? ['Output was not valid JSON'] : formatZodErrors(validation.error);
    const retry = await call(`${prompt}\n\n${buildValidationRetryPrompt('requirements set', errors)}`);
    if (retry.body) {
      onEvent({ type: 'done', body: retry.body });
      return;
    }
    onEvent({ type: 'error', error: 'The model did not return a valid requirements set after one retry' });
  } catch (err: unknown) {
    onEvent({ type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
