import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Builds a throwaway repository on disk. Fixtures are created at test time
 * rather than committed so this repo never contains files that look like
 * leaked credentials.
 */
export async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'runready-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, 'utf8');
  }
  return root;
}

export async function removeRepo(root: string) {
  await rm(root, { recursive: true, force: true });
}
