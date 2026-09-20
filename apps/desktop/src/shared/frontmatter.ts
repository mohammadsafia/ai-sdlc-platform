// apps/desktop/src/shared/frontmatter.ts
/**
 * Minimal YAML frontmatter reader. Supports only what SKILL.md needs:
 * top-level `key: value` lines, quoted scalars, and `|` / `>` block scalars
 * folded to a single line. Nested structures are ignored.
 */

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

export function parseFrontmatter(content: string): Frontmatter | null {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;

  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return null;

  const block = normalized.slice(4, end);
  const afterClose = normalized.indexOf('\n', end + 1);
  const body = afterClose === -1 ? '' : normalized.slice(afterClose + 1);

  const lines = block.split('\n');
  const fields: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2];

    if (value === '|' || value === '>') {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        parts.push(lines[i + 1].trim());
        i++;
      }
      value = parts.join(' ');
    } else {
      value = unquote(value);
    }
    fields[key] = value;
  }

  return { fields, body };
}
