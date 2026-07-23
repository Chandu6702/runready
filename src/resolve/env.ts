import path from 'node:path';
import YAML from 'yaml';
import { parseDotenv } from '../scan/dotenv.js';
import { listFiles, readIfPresent } from '../util/files.js';
import type { ConfigVar, ResolvedConfigVar } from '../types.js';

/**
 * Files that hold real local values (as opposed to examples). These are the
 * conventional "your machine only, git-ignored" locations.
 */
const LOCAL_VALUE_FILES = [
  '**/.env',
  '**/.env.local',
  '**/.env.development',
  '**/*local.{yml,yaml}',
  '**/*local.properties',
  '**/*secrets*.{yml,yaml,properties}',
];

const PLACEHOLDER_VALUES = new Set(['', 'changeme', 'change-me', 'todo', 'xxx', 'your-value']);

function isRealValue(value: string): boolean {
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) {
    return false;
  }
  return !(trimmed.startsWith('<') && trimmed.endsWith('>'));
}

/** Flattens nested YAML into dot-notation keys: spring.datasource.url. */
function flattenYaml(node: unknown, prefix = '', out = new Map<string, string>()) {
  if (node === null || node === undefined) {
    return out;
  }
  if (typeof node !== 'object') {
    out.set(prefix, String(node));
    return out;
  }
  if (Array.isArray(node)) {
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flattenYaml(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

export interface LocalValues {
  /** Variable name (or dotted key) -> file that provides it. */
  providers: Map<string, string>;
}

export async function collectLocalValues(root: string): Promise<LocalValues> {
  const providers = new Map<string, string>();
  const files = await listFiles(root, LOCAL_VALUE_FILES);

  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }

    const extension = path.extname(file.relative).toLowerCase();
    if (extension === '.yml' || extension === '.yaml') {
      try {
        for (const [key, value] of flattenYaml(YAML.parse(contents))) {
          if (isRealValue(value)) {
            providers.set(key, file.relative);
          }
        }
      } catch {
        // Unparseable YAML is not fatal — other sources may still provide values.
      }
      continue;
    }

    for (const [key, value] of parseDotenv(contents)) {
      if (isRealValue(value)) {
        providers.set(key, file.relative);
      }
    }
  }

  return { providers };
}

/**
 * Spring reads DB_URL from the environment but writes it as
 * spring.datasource.url in yml — check both spellings before declaring a
 * value missing.
 */
function yamlAliases(name: string): string[] {
  const lower = name.toLowerCase().replace(/_/g, '.');
  return [name, lower, `spring.${lower}`];
}

export function resolveConfig(vars: ConfigVar[], local: LocalValues): ResolvedConfigVar[] {
  return vars.map((entry) => {
    if (process.env[entry.name] !== undefined && process.env[entry.name] !== '') {
      return { ...entry, status: 'set', setBy: 'environment' };
    }

    for (const alias of yamlAliases(entry.name)) {
      const provider = local.providers.get(alias);
      if (provider) {
        return { ...entry, status: 'set', setBy: provider };
      }
    }

    if (entry.defaultValue !== undefined) {
      return { ...entry, status: 'defaulted' };
    }
    return { ...entry, status: 'missing' };
  });
}
