import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

/** Directories that never contain hand-written configuration. */
const ALWAYS_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/target/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.terraform/**',
  '**/*.min.js',
  '**/*.lock',
  '**/package-lock.json',
];

/**
 * Tests deliberately contain fake credentials and env-var references that
 * describe fixtures rather than real configuration, so they are excluded
 * from both config discovery and secret detection.
 */
const TEST_PATHS = [
  '**/*.{test,spec}.{js,mjs,cjs,jsx,ts,mts,cts,tsx}',
  '**/tests/**',
  '**/test/**',
  '**/__tests__/**',
  '**/src/test/**',
];

/**
 * Extra ignores taken from the repo's .gitignore. Only simple directory and
 * glob lines are honoured — enough to skip generated output without
 * reimplementing git's matching rules.
 */
async function gitignorePatterns(root: string): Promise<string[]> {
  try {
    const contents = await readFile(path.join(root, '.gitignore'), 'utf8');
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .map((line) => {
        const cleaned = line.replace(/^\/+/, '').replace(/\/+$/, '');
        return cleaned.includes('*') ? `**/${cleaned}` : `**/${cleaned}/**`;
      });
  } catch {
    return [];
  }
}

export interface RepoFile {
  /** Path relative to the repository root, using forward slashes. */
  relative: string;
  absolute: string;
}

export async function listFiles(
  root: string,
  patterns: string[],
  options: { respectGitignore?: boolean; includeTests?: boolean } = {},
): Promise<RepoFile[]> {
  const ignore = [
    ...ALWAYS_IGNORED,
    ...(options.includeTests === true ? [] : TEST_PATHS),
    ...(options.respectGitignore === false ? [] : await gitignorePatterns(root)),
  ];
  const matches = await fg(patterns, {
    cwd: root,
    ignore,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  });

  return matches.sort().map((relative) => ({
    relative,
    absolute: path.join(root, relative),
  }));
}

export async function readIfPresent(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Splits into lines once so scanners can report line numbers cheaply. */
export function eachLine(contents: string, visit: (line: string, lineNumber: number) => void) {
  const lines = contents.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    visit(lines[i] ?? '', i + 1);
  }
}

/**
 * A commented-out reference documents history, not a live requirement.
 * Covers //, #, and both forms of block-comment body.
 */
export function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  );
}
