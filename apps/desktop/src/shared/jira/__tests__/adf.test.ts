// apps/desktop/src/shared/jira/__tests__/adf.test.ts
import { describe, it, expect } from 'vitest';
import { adfToText, markdownToAdf } from '../adf';

describe('markdownToAdf', () => {
  it('converts headings, paragraphs, bullets and checklists', () => {
    const doc = markdownToAdf('# Title\n\nFirst para line one\nline two\n\n## Sub\n- [ ] a\n- [x] b\n* plain `code` and [link](http://x)\n\nLast');
    expect(doc.type).toBe('doc');
    const types = doc.content.map((n) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'heading', 'bulletList', 'paragraph']);
    expect(doc.content[0].attrs).toEqual({ level: 1 });
    expect(doc.content[1].content?.[0].text).toBe('First para line one line two');
    const items = doc.content[3].content ?? [];
    expect(items).toHaveLength(3);
    expect(items[0].content?.[0].content?.[0].text).toBe('[ ] a');
    expect(items[2].content?.[0].content?.[0].text).toBe('plain code and link');
  });
  it('returns an empty paragraph for empty input', () => {
    expect(markdownToAdf('   ').content).toEqual([{ type: 'paragraph', content: [] }]);
  });
});

describe('adfToText', () => {
  it('flattens text nodes with line breaks per block and bullets per list item', () => {
    const doc = markdownToAdf('# T\n\npara\n- one\n- two');
    expect(adfToText(doc)).toBe('T\npara\n- one\n- two');
    expect(adfToText(null)).toBe('');
  });
});
