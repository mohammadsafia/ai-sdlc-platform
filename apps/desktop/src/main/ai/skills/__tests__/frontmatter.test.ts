// apps/desktop/src/main/ai/skills/__tests__/frontmatter.test.ts
import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../frontmatter';

describe('parseFrontmatter', () => {
  it('parses simple key: value pairs and returns the body', () => {
    const r = parseFrontmatter('---\nname: my-skill\ndescription: Does things\n---\n# Body\ntext');
    expect(r).toEqual({ fields: { name: 'my-skill', description: 'Does things' }, body: '# Body\ntext' });
  });

  it('strips single and double quotes', () => {
    const r = parseFrontmatter('---\nname: "a-b"\ndescription: \'x: y\'\n---\n');
    expect(r?.fields).toEqual({ name: 'a-b', description: 'x: y' });
  });

  it('folds block scalars (| and >) into one line', () => {
    const r = parseFrontmatter('---\nname: a\ndescription: >\n  first line\n  second line\n---\nbody');
    expect(r?.fields.description).toBe('first line second line');
    expect(r?.body).toBe('body');
  });

  it('ignores unknown keys but keeps them in fields', () => {
    const r = parseFrontmatter('---\nname: a\nlicense: MIT\ndescription: d\n---\n');
    expect(r?.fields.license).toBe('MIT');
  });

  it('returns null when there is no frontmatter block', () => {
    expect(parseFrontmatter('# just markdown')).toBeNull();
    expect(parseFrontmatter('---\nname: a\n')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const r = parseFrontmatter('---\r\nname: a\r\ndescription: d\r\n---\r\nbody');
    expect(r?.fields).toEqual({ name: 'a', description: 'd' });
    expect(r?.body).toBe('body');
  });
});
