// apps/desktop/src/shared/brd/__tests__/structure.test.ts
import { describe, it, expect } from 'vitest';
import { slugify, parseBrdFrontmatter, checkBrdStructure, BRD_REQUIRED_SECTIONS } from '../structure';

const fm = '---\ntitle: Customer Onboarding\nstatus: draft\ncreated: 2026-09-20\n---\n';
const full = `${fm}# Customer Onboarding

## Summary

We need a guided onboarding.

## Problem and goals

New users churn in week one.

## Success metrics

Activation rate above 40%.

## Users and stakeholders

New customers; support team.

## Scope

### In scope

Signup wizard.

### Out of scope

Billing.

## Functional requirements

### Wizard

1. The wizard has three steps.

## Non-functional requirements

Loads under 2 seconds.

## Milestones

### Milestone 1: Wizard

Signup wizard end to end.

## Constraints and assumptions

Uses the existing auth service.

## Open questions

None.
`;

describe('slugify', () => {
  it('produces kebab-case slugs and a fallback', () => {
    expect(slugify('Customer Onboarding v2!')).toBe('customer-onboarding-v2');
    expect(slugify('  --Hello__World--  ')).toBe('hello-world');
    expect(slugify('***')).toBe('brd');
  });
});

describe('parseBrdFrontmatter', () => {
  it('reads fields and defaults status', () => {
    const r = parseBrdFrontmatter('---\ntitle: X\ncreated: 2026-01-01\nowner: Sam\n---\nbody');
    expect(r).toEqual({ title: 'X', status: 'draft', owner: 'Sam', created: '2026-01-01', errors: [] });
  });

  it('reports missing frontmatter, missing title/created, and bad status', () => {
    expect(parseBrdFrontmatter('# no fm').errors).toEqual(['Frontmatter block is missing']);
    const r = parseBrdFrontmatter('---\nstatus: bogus\n---\n');
    expect(r.errors).toEqual(['title is required', 'created is required', 'status must be one of draft, review, approved']);
    expect(r.status).toBe('draft');
  });
});

describe('checkBrdStructure', () => {
  it('passes a complete document', () => {
    const r = checkBrdStructure(full);
    expect(r.ok).toBe(true);
    expect(r.frontmatterErrors).toEqual([]);
    expect(r.sections.filter((s) => s.required).map((s) => s.heading)).toEqual([...BRD_REQUIRED_SECTIONS]);
    expect(r.sections.every((s) => s.present && !s.empty)).toBe(true);
  });

  it('fails when a required section is missing', () => {
    const r = checkBrdStructure(full.replace('## Milestones', '## Timeline'));
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.heading === 'Milestones')).toMatchObject({ present: false, empty: true, required: true });
  });

  it('treats placeholder-only and heading-only content as empty', () => {
    const r = checkBrdStructure(
      full
        .replace('We need a guided onboarding.', '<One paragraph: what this is and why now.>')
        .replace('1. The wizard has three steps.', '1. <Requirement>'),
    );
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.heading === 'Summary')).toMatchObject({ present: true, empty: true });
    expect(r.sections.find((s) => s.heading === 'Functional requirements')).toMatchObject({ present: true, empty: true });
  });

  it('does not fail on missing optional sections but lists them', () => {
    const r = checkBrdStructure(full.replace(/## Open questions[\s\S]*$/, ''));
    expect(r.ok).toBe(true);
    expect(r.sections.find((s) => s.heading === 'Open questions')).toMatchObject({ required: false, present: false });
  });

  it('matches headings case-insensitively and surfaces frontmatter errors', () => {
    const r = checkBrdStructure(full.replace('## Summary', '## SUMMARY').replace('title: Customer Onboarding\n', ''));
    expect(r.sections.find((s) => s.heading === 'Summary')?.present).toBe(true);
    expect(r.frontmatterErrors).toEqual(['title is required']);
    expect(r.ok).toBe(false);
  });
});
