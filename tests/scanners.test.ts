import { afterEach, describe, expect, it } from 'vitest';
import { ConfigCollector } from '../src/scan/collector.js';
import { scanNode } from '../src/scan/node.js';
import { scanSpring } from '../src/scan/spring.js';
import { scanCompose, scanDockerfiles } from '../src/scan/docker.js';
import { scanTerraform } from '../src/scan/terraform.js';
import { makeRepo, removeRepo } from './helpers.js';

let root: string;

afterEach(async () => {
  if (root) {
    await removeRepo(root);
  }
});

async function collect(files: Record<string, string>, scan: typeof scanNode) {
  root = await makeRepo(files);
  const collector = new ConfigCollector();
  await scan(root, collector);
  return collector.all();
}

describe('node scanner', () => {
  it('finds process.env and import.meta.env references', async () => {
    const vars = await collect(
      {
        'src/server.ts': [
          'const url = process.env.DATABASE_URL;',
          "const key = process.env['STRIPE_KEY'];",
          'const api = import.meta.env.VITE_API_URL;',
        ].join('\n'),
      },
      scanNode,
    );

    expect(vars.map((v) => v.name)).toEqual(['DATABASE_URL', 'STRIPE_KEY', 'VITE_API_URL']);
    expect(vars.every((v) => v.required)).toBe(true);
  });

  it('treats an inline fallback as a default', async () => {
    const vars = await collect(
      { 'src/config.ts': "const port = process.env.PORT ?? '3000';" },
      scanNode,
    );

    expect(vars[0]?.name).toBe('PORT');
    expect(vars[0]?.defaultValue).toBe('3000');
    expect(vars[0]?.required).toBe(false);
  });

  it('ignores variables the runtime injects itself', async () => {
    const vars = await collect(
      { 'src/app.ts': 'if (process.env.NODE_ENV === "production") {}' },
      scanNode,
    );

    expect(vars).toHaveLength(0);
  });
});

describe('spring scanner', () => {
  it('separates required placeholders from defaulted ones', async () => {
    const vars = await collect(
      {
        'src/main/resources/application.yml': [
          'spring:',
          '  datasource:',
          '    url: ${DB_URL:jdbc:postgresql://localhost:5432/app}',
          '    password: ${DB_PASSWORD}',
        ].join('\n'),
      },
      scanSpring,
    );

    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.DB_URL?.required).toBe(false);
    expect(byName.DB_URL?.defaultValue).toBe('jdbc:postgresql://localhost:5432/app');
    expect(byName.DB_PASSWORD?.required).toBe(true);
  });

  it('skips commented-out placeholders', async () => {
    const vars = await collect(
      { 'src/main/resources/application.yml': '# password: ${OLD_SECRET}' },
      scanSpring,
    );

    expect(vars).toHaveLength(0);
  });
});

describe('docker scanners', () => {
  it('treats a bare ARG as required and ENV with a value as defaulted', async () => {
    const vars = await collect(
      { Dockerfile: ['ARG BUILD_TOKEN', 'ENV PORT=8080'].join('\n') },
      scanDockerfiles,
    );

    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.BUILD_TOKEN?.required).toBe(true);
    expect(byName.PORT?.defaultValue).toBe('8080');
  });

  it('honours compose default and mandatory syntax', async () => {
    const vars = await collect(
      {
        'docker-compose.yml': [
          'services:',
          '  api:',
          '    environment:',
          '      A: ${DB_PASSWORD:-devpass}',
          '      B: ${JWT_SECRET:?must be set}',
        ].join('\n'),
      },
      scanCompose,
    );

    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.DB_PASSWORD?.defaultValue).toBe('devpass');
    expect(byName.JWT_SECRET?.required).toBe(true);
  });
});

describe('terraform scanner', () => {
  it('marks variables without a default as required deploy inputs', async () => {
    const vars = await collect(
      {
        'infra/variables.tf': [
          'variable "region" {',
          '  type    = string',
          '  default = "ap-south-1"',
          '}',
          '',
          'variable "db_password" {',
          '  type      = string',
          '  sensitive = true',
          '}',
        ].join('\n'),
      },
      scanTerraform,
    );

    const byName = Object.fromEntries(vars.map((v) => [v.name, v]));
    expect(byName.TF_VAR_region?.required).toBe(false);
    expect(byName.TF_VAR_region?.defaultValue).toBe('ap-south-1');
    expect(byName.TF_VAR_db_password?.required).toBe(true);
    // Deploy inputs must never block local development.
    expect(byName.TF_VAR_db_password?.scope).toBe('deploy');
  });
});
