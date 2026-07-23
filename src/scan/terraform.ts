import { listFiles, readIfPresent } from '../util/files.js';
import type { ConfigCollector } from './collector.js';

/**
 * Terraform inputs are supplied as TF_VAR_<name> (or a tfvars file), so a
 * variable block without a default is a required piece of configuration.
 */
const VARIABLE_BLOCK = /variable\s+"([^"]+)"\s*\{/g;

export async function scanTerraform(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, ['**/*.tf']);
  let found = false;

  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }
    found = true;

    VARIABLE_BLOCK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = VARIABLE_BLOCK.exec(contents))) {
      const name = match[1];
      if (!name) {
        continue;
      }
      const body = blockBody(contents, match.index + match[0].length - 1);
      const hasDefault = /(^|\n)\s*default\s*=/.test(body);
      const line = contents.slice(0, match.index).split(/\r?\n/).length;

      collector.add({
        name: `TF_VAR_${name}`,
        ecosystem: 'terraform',
        defaultValue: hasDefault ? defaultOf(body) : undefined,
        required: !hasDefault,
        source: { file: file.relative, line },
      });
    }
  }

  return found;
}

/** Returns the text between the braces starting at openIndex. */
function blockBody(contents: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < contents.length; i++) {
    const char = contents[i];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return contents.slice(openIndex + 1, i);
      }
    }
  }
  return contents.slice(openIndex + 1);
}

function defaultOf(body: string): string | undefined {
  const match = /(^|\n)\s*default\s*=\s*(.+)/.exec(body);
  return match?.[2]?.trim().replace(/^["']|["']$/g, '');
}
