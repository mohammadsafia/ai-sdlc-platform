// apps/desktop/src/main/brd/templates.ts
/**
 * Template files shipped with the app (apps/desktop/templates/).
 * Resolution mirrors prompts/prompt-loader.ts: process.resourcesPath when
 * packaged, otherwise the first candidate containing brd-template.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM-compatible __dirname (the main bundle is ESM; see changelog-service.ts)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let resolved: string | null = null;

export function resolveTemplatesDir(): string {
  if (resolved) return resolved;
  try {
    const { app } = require('electron') as typeof import('electron');
    if (app?.isPackaged) {
      resolved = join(process.resourcesPath, 'templates');
      return resolved;
    }
  } catch {
    // Not in the Electron main process (tests, workers)
  }
  const candidates = [
    join(__dirname, '..', '..', '..', 'templates'),
    join(__dirname, '..', '..', 'templates'),
    join(__dirname, '..', 'templates'),
    join(__dirname, 'templates'),
    join(__dirname, '..', '..', '..', '..', 'apps', 'desktop', 'templates'),
  ];
  resolved = candidates.find((c) => existsSync(join(c, 'brd-template.md'))) ?? candidates[0];
  return resolved;
}

export function loadTemplate(name: string): string {
  const dir = resolveTemplatesDir();
  const file = join(dir, `${name}.md`);
  if (!existsSync(file)) {
    throw new Error(`Template file not found: ${file}\nTemplates directory resolved to: ${dir}`);
  }
  return readFileSync(file, 'utf-8');
}

export function renderBrdTemplate(title: string, createdIso: string): string {
  return loadTemplate('brd-template').replace(/<Title>/g, title).replace(/<YYYY-MM-DD>/g, createdIso);
}
