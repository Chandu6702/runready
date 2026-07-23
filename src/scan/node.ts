import { eachLine, isComment, listFiles, readIfPresent } from '../util/files.js';
import type { ConfigCollector } from './collector.js';

const PATTERNS = [
  // process.env.FOO
  /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
  // process.env['FOO'] / process.env["FOO"]
  /process\.env\[\s*['"]([^'"]+)['"]\s*\]/g,
  // Vite: import.meta.env.VITE_FOO
  /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
];

/** Values Vite/Node inject themselves — not something a developer must set. */
const BUILT_INS = new Set(['NODE_ENV', 'MODE', 'BASE_URL', 'DEV', 'PROD', 'SSR']);

/**
 * Detects a fallback on the same line: `process.env.PORT ?? 3000`,
 * `process.env.PORT || 3000`, `process.env.PORT ?: '3000'`.
 */
function inlineFallback(line: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `process\\.env(?:\\.${escaped}|\\[['"]${escaped}['"]\\])\\s*(?:\\?\\?|\\|\\|)\\s*([^;,)\\n]+)`,
  ).exec(line);
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '');
}

export async function scanNode(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, [
    '**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
    '**/package.json',
  ]);
  if (files.length === 0) {
    return false;
  }

  let found = false;
  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }

    eachLine(contents, (line, lineNumber) => {
      if (isComment(line)) {
        return;
      }
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line))) {
          const name = match[1];
          if (!name || BUILT_INS.has(name)) {
            continue;
          }
          found = true;
          collector.add({
            name,
            ecosystem: 'node',
            defaultValue: inlineFallback(line, name),
            source: { file: file.relative, line: lineNumber },
          });
        }
      }
    });
  }

  return files.some((file) => file.relative.endsWith('package.json')) || found;
}
