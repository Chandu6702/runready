import { eachLine, isComment, listFiles, readIfPresent } from '../util/files.js';
import type { ConfigCollector } from './collector.js';

/** ${VAR} or ${VAR:default} as used in Spring yml/properties and @Value. */
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_.]*)(?::([^}]*))?\}/g;

/**
 * Spring resolves placeholders from environment variables, so DB_URL and
 * db.url are the same knob. Names are reported as written.
 */
export async function scanSpring(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, [
    '**/application*.{yml,yaml,properties}',
    '**/bootstrap*.{yml,yaml,properties}',
    '**/*.java',
    '**/*.kt',
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
      PLACEHOLDER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PLACEHOLDER.exec(line))) {
        const name = match[1];
        if (!name) {
          continue;
        }
        found = true;
        collector.add({
          name,
          ecosystem: 'spring',
          defaultValue: match[2],
          source: { file: file.relative, line: lineNumber },
        });
      }
    });
  }

  return found;
}
