// apps/desktop/src/shared/jira/adf.ts
export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
}
export interface AdfDocument { version: 1; type: 'doc'; content: AdfNode[] }

const text = (t: string): AdfNode => ({ type: 'text', text: t });
const paragraph = (t: string): AdfNode => ({ type: 'paragraph', content: t ? [text(t)] : [] });

/** Strip the inline Markdown we do not render: code spans, links, emphasis. */
function inline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .trim();
}

/** Markdown subset → ADF: headings 1-3, paragraphs, bullet lists (task markers kept as text). */
export function markdownToAdf(markdown: string): AdfDocument {
  const content: AdfNode[] = [];
  let para: string[] = [];
  let list: AdfNode[] = [];
  const flushPara = () => {
    if (para.length) {
      content.push(paragraph(para.join(' ')));
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      content.push({ type: 'bulletList', content: list });
      list = [];
    }
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      content.push({ type: 'heading', attrs: { level: heading[1].length }, content: [text(inline(heading[2]))] });
    } else if (bullet) {
      flushPara();
      list.push({ type: 'listItem', content: [paragraph(inline(bullet[1]))] });
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(inline(line));
    }
  }
  flushPara();
  flushList();
  if (content.length === 0) content.push(paragraph(''));
  return { version: 1, type: 'doc', content };
}

/** ADF → plain text: one line per block, "- " before list items. Tolerates any input. */
export function adfToText(doc: unknown): string {
  const lines: string[] = [];
  const walk = (node: unknown, prefix: string): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as AdfNode;
    if (n.type === 'text') {
      lines[lines.length - 1] = (lines[lines.length - 1] ?? '') + (n.text ?? '');
      return;
    }
    if (n.type === 'paragraph' || n.type === 'heading') lines.push(prefix);
    for (const child of n.content ?? []) walk(child, n.type === 'listItem' ? '- ' : '');
  };
  walk(doc, '');
  return lines.map((l) => l.trimEnd()).filter((l) => l.length > 0).join('\n');
}
