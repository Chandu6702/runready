import { eachLine, listFiles, readIfPresent } from '../util/files.js';
import type { ConfigCollector } from './collector.js';

const ASSIGNMENT = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/** Example files declare what a developer is expected to provide. */
const EXAMPLE_FILES = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.defaults',
];

export function parseDotenv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  eachLine(contents, (line) => {
    if (line.trimStart().startsWith('#')) {
      return;
    }
    const match = ASSIGNMENT.exec(line);
    if (!match?.[1]) {
      return;
    }
    const raw = (match[2] ?? '').trim();
    const unquoted = raw.replace(/^(['"])(.*)\1$/, '$2');
    values.set(match[1], unquoted);
  });
  return values;
}

export async function scanEnvExamples(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, EXAMPLE_FILES);
  let found = false;

  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }
    found = true;

    eachLine(contents, (line, lineNumber) => {
      if (line.trimStart().startsWith('#')) {
        return;
      }
      const match = ASSIGNMENT.exec(line);
      if (!match?.[1]) {
        return;
      }
      collector.add({
        name: match[1],
        ecosystem: 'dotenv',
        required: true,
        source: { file: file.relative, line: lineNumber },
      });
    });
  }

  return found;
}
