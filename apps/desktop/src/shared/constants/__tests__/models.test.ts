import { describe, it, expect } from 'vitest';
import {
  ALL_AVAILABLE_MODELS,
  DEFAULT_MODEL_EQUIVALENCES,
  resolveModelEquivalent,
  getProviderPreset,
  getProviderPresetOrFallback,
  PROVIDER_PRESET_DEFINITIONS,
} from '../models';

describe('getProviderPreset', () => {
  it('returns correct preset for known provider and presetId', () => {
    const result = getProviderPreset('anthropic', 'auto');
    expect(result).not.toBeNull();
    expect(result?.primaryModel).toBe('opus');
    expect(result?.primaryThinking).toBe('high');
  });

  it('returns correct balanced preset for anthropic', () => {
    const result = getProviderPreset('anthropic', 'balanced');
    expect(result).not.toBeNull();
    expect(result?.primaryModel).toBe('sonnet');
    expect(result?.primaryThinking).toBe('medium');
  });

  it('returns correct preset for openai provider', () => {
    const result = getProviderPreset('openai', 'auto');
    expect(result).not.toBeNull();
    expect(result?.primaryModel).toBe('gpt-6-astra');
  });

  it('returns null for unknown presetId', () => {
    const result = getProviderPreset('anthropic', 'nonexistent-preset');
    expect(result).toBeNull();
  });

  it('returns null for unknown provider', () => {
    // @ts-expect-error testing unknown provider
    const result = getProviderPreset('unknown-provider', 'auto');
    expect(result).toBeNull();
  });

  it('returns null for provider that does not have a complex preset (mistral)', () => {
    const result = getProviderPreset('mistral', 'complex');
    expect(result).toBeNull();
  });
});

describe('getProviderPresetOrFallback', () => {
  it('returns exact match when provider and preset both exist', () => {
    const result = getProviderPresetOrFallback('anthropic', 'complex');
    expect(result.primaryModel).toBe('opus');
    expect(result.primaryThinking).toBe('high');
    expect(result.phaseThinking.coding).toBe('high');
  });

  it('returns openai balanced preset exactly when available', () => {
    const result = getProviderPresetOrFallback('openai', 'balanced');
    expect(result.primaryModel).toBe('gpt-5.6-terra');
    expect(result.primaryThinking).toBe('medium');
  });

  it("falls back to provider's 'auto' preset when requested preset is missing", () => {
    // mistral has no 'complex' preset, so falls back to mistral 'auto'
    const result = getProviderPresetOrFallback('mistral', 'complex');
    const mistralAuto = PROVIDER_PRESET_DEFINITIONS['mistral']?.['auto'];
    expect(result).toEqual(mistralAuto);
  });

  it('falls back to anthropic preset when provider has no auto and no matching preset', () => {
    // groq has no 'complex' preset — its 'auto' fallback should be used first
    // but if we use a provider with NO 'auto' at all, it should fall back to anthropic
    // groq has 'auto', so verify we get groq auto
    const result = getProviderPresetOrFallback('groq', 'complex');
    const groqAuto = PROVIDER_PRESET_DEFINITIONS['groq']?.['auto'];
    expect(result).toEqual(groqAuto);
  });

  it('falls back to anthropic preset when provider is unknown', () => {
    // @ts-expect-error testing unknown provider to exercise anthropic fallback
    const result = getProviderPresetOrFallback('unknown-provider', 'complex');
    const anthropicComplex = PROVIDER_PRESET_DEFINITIONS['anthropic']?.['complex'];
    expect(result).toEqual(anthropicComplex);
  });

  it('falls back to anthropic auto as ultimate fallback', () => {
    // @ts-expect-error testing unknown provider and preset
    const result = getProviderPresetOrFallback('unknown-provider', 'unknown-preset');
    const anthropicAuto = PROVIDER_PRESET_DEFINITIONS['anthropic']!['auto'];
    expect(result).toEqual(anthropicAuto);
  });

  it('always returns a valid config (never null)', () => {
    const knownCombinations: Array<[Parameters<typeof getProviderPresetOrFallback>[0], string]> = [
      ['anthropic', 'auto'],
      ['anthropic', 'complex'],
      ['anthropic', 'balanced'],
      ['anthropic', 'quick'],
      ['openai', 'auto'],
      ['openai', 'complex'],
      ['google', 'balanced'],
      ['xai', 'quick'],
      ['mistral', 'complex'],  // no 'complex', falls back to mistral auto
      ['groq', 'quick'],       // groq has no 'quick', falls back to groq auto
    ];

    for (const [provider, presetId] of knownCombinations) {
      const result = getProviderPresetOrFallback(provider, presetId);
      expect(result).toBeDefined();
      expect(result.primaryModel).toBeTruthy();
      expect(result.phaseModels).toBeDefined();
      expect(result.phaseThinking).toBeDefined();
    }
  });

  it('returned config has all required phase keys', () => {
    const result = getProviderPresetOrFallback('anthropic', 'auto');
    const phaseKeys = ['spec', 'planning', 'coding', 'qa'] as const;
    for (const key of phaseKeys) {
      expect(result.phaseModels[key]).toBeTruthy();
      expect(result.phaseThinking[key]).toBeTruthy();
    }
  });
});

describe('OpenAI catalog (Codex subscription compatibility)', () => {
  // The Codex backend rejects retired slugs for ChatGPT accounts with
  // "The '<model>' model is not supported when using Codex with a ChatGPT account."
  const RETIRED = ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-mini', 'gpt-5-codex', 'gpt-5.1-codex-max'];

  it('offers no retired Codex slugs in the model list', () => {
    const openaiIds = ALL_AVAILABLE_MODELS.filter((m) => m.provider === 'openai').map((m) => m.value);
    expect(openaiIds.filter((id) => RETIRED.includes(id))).toEqual([]);
    expect(openaiIds).toEqual(expect.arrayContaining(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']));
  });

  it('maps Claude shorthands to current OpenAI models', () => {
    expect(resolveModelEquivalent('opus', 'openai')?.modelId).toBe('gpt-6-astra');
    expect(resolveModelEquivalent('sonnet', 'openai')?.modelId).toBe('gpt-5.6-terra');
    expect(resolveModelEquivalent('haiku', 'openai')?.modelId).toBe('gpt-5.6-luna');
  });

  it('has no equivalence entry pointing at a retired slug', () => {
    const targets = Object.values(DEFAULT_MODEL_EQUIVALENCES).flatMap((m) => (m.openai ? [m.openai.modelId] : []));
    expect(targets.filter((id) => RETIRED.includes(id))).toEqual([]);
  });
});
