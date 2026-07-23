import { afterEach, describe, expect, it } from 'vitest';
import { findSecrets } from '../src/resolve/secrets.js';
import { makeRepo, removeRepo } from './helpers.js';

let root: string;

afterEach(async () => {
  if (root) {
    await removeRepo(root);
  }
});

describe('secret detection', () => {
  it('flags a real-looking credential in a config file', async () => {
    root = await makeRepo({
      'application.yml': ['spring:', '  datasource:', '    password: Sup3rSecret$2026'].join('\n'),
    });

    const findings = await findSecrets(root);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('password');
    expect(findings[0]?.source.line).toBe(3);
    // The value itself must never be echoed back in full.
    expect(findings[0]?.preview).not.toContain('Sup3rSecret$2026');
  });

  it('recognises provider-specific key formats', async () => {
    root = await makeRepo({
      'config.ts': 'const key = "AKIAIOSFODNN7EXAMPLE";',
    });

    const findings = await findSecrets(root);
    expect(findings[0]?.kind).toBe('AWS access key');
  });

  it('ignores placeholders, type annotations and indirection', async () => {
    root = await makeRepo({
      'types.ts': 'interface Login { password: string; token: string }',
      'infra.tf': 'password = var.db_password',
      'app.yml': 'password: ${DB_PASSWORD}',
      'sample.env': 'PASSWORD=change-me',
      'code.ts': 'const password = process.env.DB_PASSWORD;',
    });

    expect(await findSecrets(root)).toHaveLength(0);
  });

  it('does not flag values in example files', async () => {
    root = await makeRepo({
      '.env.example': 'DB_PASSWORD=Sup3rSecret$2026',
    });

    expect(await findSecrets(root)).toHaveLength(0);
  });

  it('reports secrets in files git does not track as safe', async () => {
    root = await makeRepo({
      '.gitignore': 'application-local.yml\n',
      'application-local.yml': 'password: Sup3rSecret$2026',
    });

    const findings = await findSecrets(root);

    // Still discovered — but not an incident, because git never sees it.
    expect(findings).toHaveLength(1);
    expect(findings[0]?.committed).toBe(false);
  });
});
