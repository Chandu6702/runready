import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eachLine, isComment, listFiles, readIfPresent } from '../util/files.js';
import type { SecretFinding } from '../types.js';

const run = promisify(execFile);

interface Rule {
  kind: string;
  pattern: RegExp;
  /** Capture group holding the sensitive value. */
  group: number;
}

const RULES: Rule[] = [
  { kind: 'AWS access key', pattern: /\b(AKIA[0-9A-Z]{16})\b/, group: 1 },
  { kind: 'GitHub token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{16,})\b/, group: 1 },
  { kind: 'Slack token', pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/, group: 1 },
  { kind: 'Anthropic API key', pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/, group: 1 },
  { kind: 'OpenAI API key', pattern: /\b(sk-[A-Za-z0-9]{32,})\b/, group: 1 },
  { kind: 'private key', pattern: /(-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----)/, group: 1 },
  { kind: 'JDBC password', pattern: /jdbc:[^\s"']*[?&]password=([^\s&"']+)/i, group: 1 },
  { kind: 'connection string password', pattern: /\/\/[^\s:/@"']+:([^\s@"']{6,})@/, group: 1 },
  {
    kind: 'password',
    pattern: /(?:^|[\s"'{,])(?:password|passwd|pwd|secret|token|api[-_]?key)["']?\s*[:=]\s*["']?([^\s"',}]{6,})/i,
    group: 1,
  },
];

/** Values that are obviously not real credentials. */
const PLACEHOLDER = /^(?:\$\{|<|change|your|example|dummy|sample|placeholder|todo|xxx|test|dev-only|localhost|password|secret|null|true|false|\*+$)/i;

/** Type annotations: `password: string`, `secret?: String`, `token: number`. */
const TYPE_NAME = /^(?:string|number|boolean|any|unknown|object|String|Integer|Long|Boolean|char|byte\[\])$/;

/** A reference to a value rather than the value: var.db_password, config.token. */
const REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function looksPlaceholder(raw: string): boolean {
  // Trailing syntax gets swept up by the line-based match.
  const value = raw.replace(/[;,)}\]]+$/, '').trim();

  if (value.length < 6 || PLACEHOLDER.test(value)) {
    return true;
  }
  // Indirection — env vars, config lookups, Terraform vars — is the correct
  // pattern, not a leak.
  if (value.includes('${') || TYPE_NAME.test(value) || REFERENCE.test(value)) {
    return true;
  }
  // Require some variety — "aaaaaaaa" or "postgres" alone is not a secret.
  const distinct = new Set(value).size;
  const hasDigit = /\d/.test(value);
  const hasUpper = /[A-Z]/.test(value);
  const hasSymbol = /[^A-Za-z0-9]/.test(value);
  return distinct < 5 || (!hasDigit && !hasUpper && !hasSymbol);
}

function mask(value: string): string {
  if (value.length <= 6) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 3)}${'*'.repeat(Math.min(value.length - 5, 12))}${value.slice(-2)}`;
}

/**
 * Files git would actually publish. Anything ignored is safe on disk, which
 * is exactly the distinction that matters — a real password in a git-ignored
 * file is correct practice, the same password in a tracked file is an
 * incident.
 */
/**
 * Files that survive .gitignore — used when git itself cannot answer.
 */
async function gitignoreFallback(root: string): Promise<(relative: string) => boolean> {
  const visible = await listFiles(root, SCANNED_PATTERNS);
  const visibleSet = new Set(visible.map((file) => file.relative));
  return (relative: string) => visibleSet.has(relative);
}

async function trackedFiles(root: string): Promise<Set<string> | null> {
  try {
    const { stdout } = await run('git', ['ls-files'], { cwd: root, timeout: 10_000, windowsHide: true });
    const files = new Set(
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
    // Empty means a repository with nothing committed yet — git cannot tell
    // us anything useful, so let .gitignore decide instead.
    return files.size > 0 ? files : null;
  } catch {
    return null; // not a git repository
  }
}

const SCANNED_PATTERNS = [
  '**/*.{yml,yaml,properties,env,json,ts,js,mjs,cjs,tsx,jsx,java,kt,tf,tfvars,sh,xml,ini,conf,toml}',
  '**/.env*',
  '**/Dockerfile*',
];

export async function findSecrets(root: string): Promise<SecretFinding[]> {
  const tracked = await trackedFiles(root);
  // Scans git-ignored files too: a real secret in an ignored file is correct
  // practice worth confirming, and the same value in a tracked file is the
  // incident this check exists to catch.
  const files = await listFiles(root, SCANNED_PATTERNS, { respectGitignore: false });

  // Outside a git repository (or before the first commit) fall back to the
  // .gitignore rules, so the distinction still holds.
  const wouldBeCommitted = tracked
    ? (relative: string) => tracked.has(relative)
    : await gitignoreFallback(root);

  const findings: SecretFinding[] = [];

  for (const file of files) {
    // Example files exist to hold fake values.
    if (/\.(example|sample|template|defaults)$/i.test(file.relative)) {
      continue;
    }

    const contents = await readIfPresent(file.absolute);
    if (!contents || contents.length > 2_000_000) {
      continue;
    }

    eachLine(contents, (line, lineNumber) => {
      if (line.length > 500 || isComment(line)) {
        return;
      }
      for (const rule of RULES) {
        const match = rule.pattern.exec(line);
        const value = match?.[rule.group];
        if (!value || looksPlaceholder(value)) {
          continue;
        }
        findings.push({
          kind: rule.kind,
          source: { file: file.relative, line: lineNumber },
          preview: mask(value),
          committed: wouldBeCommitted(file.relative),
        });
        break; // one finding per line is enough to act on
      }
    });
  }

  // Committed leaks first — those are the ones that need action now.
  return findings.sort((a, b) => Number(b.committed) - Number(a.committed));
}
