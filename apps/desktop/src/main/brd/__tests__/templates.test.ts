// apps/desktop/src/main/brd/__tests__/templates.test.ts
import { describe, it, expect } from 'vitest';
import { loadTemplate, renderBrdTemplate, resolveTemplatesDir } from '../templates';
import { checkBrdStructure } from '../../../shared/brd/structure';

describe('templates', () => {
  it('resolves the templates directory in dev', () => {
    expect(resolveTemplatesDir()).toMatch(/templates$/);
  });

  it('loads the BRD template and it contains every section heading', () => {
    const t = loadTemplate('brd-template');
    for (const h of ['## Summary', '## Problem and goals', '## Scope', '## Functional requirements', '## Milestones', '## Open questions']) {
      expect(t).toContain(h);
    }
  });

  it('throws for an unknown template', () => {
    expect(() => loadTemplate('nope')).toThrow(/Template file not found/);
  });

  it('renderBrdTemplate fills title and date; the result is structurally present but empty', () => {
    const md = renderBrdTemplate('Customer Onboarding', '2026-09-20');
    expect(md.startsWith('---\ntitle: Customer Onboarding\nstatus: draft\nowner:\ncreated: 2026-09-20\n---')).toBe(true);
    expect(md).toContain('# Customer Onboarding');
    const r = checkBrdStructure(md);
    expect(r.frontmatterErrors).toEqual([]);
    expect(r.sections.filter((s) => s.required).every((s) => s.present && s.empty)).toBe(true);
    expect(r.ok).toBe(false);
  });
});
