import { describe, it, expect } from 'vitest';
import { checkDesignStructure, parseDesignFrontmatter } from '../structure';

const doc = `---
brd: todo-app
requirement: R3
title: Filter todos
status: approved
updated: 2026-09-21
---
# Filter todos

## Summary
Users filter by status.

## User flows
1. Tap a filter.

## Screens

### List
Layout: toolbar
States: empty, loading, error, success
Interactions: tap

## Components
- FilterBar

## Copy

## Accessibility

## Open questions
`;

describe('design structure', () => {
  it('parses frontmatter and validates status', () => {
    expect(parseDesignFrontmatter(doc)).toEqual({ brd: 'todo-app', requirement: 'R3', title: 'Filter todos', status: 'approved', updated: '2026-09-21', errors: [] });
    expect(parseDesignFrontmatter('# no fm').errors).toEqual(['Frontmatter block is missing']);
    expect(parseDesignFrontmatter(doc.replace('status: approved', 'status: done')).errors).toEqual(['status must be one of draft, approved']);
    expect(parseDesignFrontmatter(doc.replace('status: approved', 'status: done')).status).toBe('draft');
  });

  it('checks required and optional sections', () => {
    const r = checkDesignStructure(doc);
    expect(r.ok).toBe(true);
    expect(r.sections.map((s) => [s.heading, s.required, s.present && !s.empty])).toEqual([
      ['Summary', true, true],
      ['User flows', true, true],
      ['Screens', true, true],
      ['Components', true, true],
      ['Copy', false, false],
      ['Accessibility', false, false],
      ['Open questions', false, false],
    ]);
    expect(checkDesignStructure(doc.replace('Users filter by status.', '')).ok).toBe(false);
  });
});
