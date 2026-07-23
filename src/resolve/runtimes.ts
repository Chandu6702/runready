import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listFiles, readIfPresent } from '../util/files.js';
import type { RuntimeRequirement, SourceRef } from '../types.js';

const run = promisify(execFile);

async function version(command: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 8000, windowsHide: true });
    // `java -version` writes to stderr.
    const output = `${stdout}${stderr}`;
    return /(\d+(?:\.\d+)*)/.exec(output)?.[1];
  } catch {
    return undefined;
  }
}

function majorOf(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = /(\d+)/.exec(value);
  return match?.[1] ? Number(match[1]) : undefined;
}

interface Declared {
  name: string;
  expected: string;
  source: SourceRef;
  probe: () => Promise<string | undefined>;
}

async function declaredRuntimes(root: string): Promise<Declared[]> {
  const declared: Declared[] = [];

  for (const file of await listFiles(root, ['**/package.json'])) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }
    try {
      const parsed = JSON.parse(contents) as { engines?: { node?: string } };
      if (parsed.engines?.node) {
        declared.push({
          name: 'Node.js',
          expected: parsed.engines.node,
          source: { file: file.relative, line: 1 },
          probe: () => version('node', ['-v']),
        });
      }
    } catch {
      // Malformed package.json is the project's problem, not ours.
    }
  }

  for (const file of await listFiles(root, ['**/.nvmrc'])) {
    const contents = (await readIfPresent(file.absolute))?.trim();
    if (contents) {
      declared.push({
        name: 'Node.js',
        expected: contents,
        source: { file: file.relative, line: 1 },
        probe: () => version('node', ['-v']),
      });
    }
  }

  for (const file of await listFiles(root, ['**/pom.xml'])) {
    const contents = await readIfPresent(file.absolute);
    const match = contents ? /<java\.version>([^<]+)<\/java\.version>/.exec(contents) : null;
    if (match?.[1]) {
      declared.push({
        name: 'Java',
        expected: match[1],
        source: { file: file.relative, line: 1 },
        probe: () => version('java', ['-version']),
      });
    }
  }

  for (const file of await listFiles(root, ['**/go.mod'])) {
    const contents = await readIfPresent(file.absolute);
    const match = contents ? /^go\s+(\d+\.\d+)/m.exec(contents) : null;
    if (match?.[1]) {
      declared.push({
        name: 'Go',
        expected: match[1],
        source: { file: file.relative, line: 1 },
        probe: () => version('go', ['version']),
      });
    }
  }

  return declared;
}

export async function checkRuntimes(root: string): Promise<RuntimeRequirement[]> {
  const declared = await declaredRuntimes(root);
  const byName = new Map<string, Declared>();
  // Keep the strictest declaration per runtime.
  for (const entry of declared) {
    const existing = byName.get(entry.name);
    if (!existing || (majorOf(entry.expected) ?? 0) > (majorOf(existing.expected) ?? 0)) {
      byName.set(entry.name, entry);
    }
  }

  return Promise.all(
    [...byName.values()].map(async (entry) => {
      const installed = await entry.probe();
      const wanted = majorOf(entry.expected);
      const have = majorOf(installed);
      return {
        name: entry.name,
        expected: entry.expected,
        installed,
        satisfied: have !== undefined && wanted !== undefined && have >= wanted,
        source: entry.source,
      };
    }),
  );
}
