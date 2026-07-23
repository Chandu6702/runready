import { eachLine, listFiles, readIfPresent } from '../util/files.js';
import type { ConfigCollector } from './collector.js';

/** Compose interpolation: ${VAR}, ${VAR:-default}, ${VAR:?error message}. */
const COMPOSE_PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?]([^}]*))?\}/g;

/** Dockerfile ARG/ENV with an optional inline default. */
const DOCKER_DIRECTIVE = /^\s*(ARG|ENV)\s+([A-Za-z_][A-Za-z0-9_]*)(?:[=\s]+(.*))?$/i;

export async function scanDockerfiles(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, ['**/Dockerfile', '**/Dockerfile.*', '**/*.dockerfile']);
  let found = false;

  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }
    found = true;

    eachLine(contents, (line, lineNumber) => {
      const match = DOCKER_DIRECTIVE.exec(line);
      if (!match) {
        return;
      }
      const [, directive, name, rest] = match;
      if (!name) {
        return;
      }
      // ENV always carries a value; a bare ARG is a build input the caller
      // must supply.
      const hasValue = Boolean(rest && rest.trim().length > 0);
      collector.add({
        name,
        ecosystem: 'docker',
        defaultValue: hasValue ? rest?.trim() : undefined,
        required: directive?.toUpperCase() === 'ARG' && !hasValue,
        source: { file: file.relative, line: lineNumber },
      });
    });
  }

  return found;
}

export async function scanCompose(root: string, collector: ConfigCollector): Promise<boolean> {
  const files = await listFiles(root, [
    '**/docker-compose*.{yml,yaml}',
    '**/compose*.{yml,yaml}',
  ]);
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
      COMPOSE_PLACEHOLDER.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = COMPOSE_PLACEHOLDER.exec(line))) {
        const name = match[1];
        if (!name) {
          continue;
        }
        // ${VAR:?msg} means compose refuses to start without it.
        const isMandatory = line.includes(`${name}:?`) || line.includes(`${name}?`);
        collector.add({
          name,
          ecosystem: 'compose',
          defaultValue: isMandatory ? undefined : match[2],
          required: isMandatory,
          source: { file: file.relative, line: lineNumber },
        });
      }
    });
  }

  return found;
}
