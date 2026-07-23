import { afterEach, describe, expect, it } from 'vitest';
import { blockingIssues, scanRepository } from '../src/scan/index.js';
import { renderEnvExample } from '../src/report/envExample.js';
import { renderReport } from '../src/report/terminal.js';
import { parseArgs } from '../src/cli.js';
import { makeRepo, removeRepo } from './helpers.js';

let root: string;

afterEach(async () => {
  if (root) {
    await removeRepo(root);
  }
  delete process.env.RUNREADY_TEST_TOKEN;
});

const SAMPLE = {
  'package.json': JSON.stringify({ name: 'sample', engines: { node: '>=18' } }),
  'src/index.ts': [
    'const token = process.env.RUNREADY_TEST_TOKEN;',
    'const missing = process.env.PAYMENT_KEY;',
    "const port = process.env.PORT ?? '3000';",
  ].join('\n'),
};

async function scanSample() {
  root = await makeRepo(SAMPLE);
  return scanRepository({ root, skipServices: true, skipRuntimes: true });
}

describe('repository scan', () => {
  it('classifies each value as set, defaulted or missing', async () => {
    process.env.RUNREADY_TEST_TOKEN = 'provided';
    const report = await scanSample();
    const byName = Object.fromEntries(report.config.map((entry) => [entry.name, entry]));

    expect(byName.RUNREADY_TEST_TOKEN?.status).toBe('set');
    expect(byName.RUNREADY_TEST_TOKEN?.setBy).toBe('environment');
    expect(byName.PORT?.status).toBe('defaulted');
    expect(byName.PAYMENT_KEY?.status).toBe('missing');
  });

  it('counts only missing runtime values as blocking', async () => {
    process.env.RUNREADY_TEST_TOKEN = 'provided';
    const report = await scanSample();
    expect(blockingIssues(report)).toBe(1);
  });

  it('resolves values from a local dotenv file', async () => {
    root = await makeRepo({ ...SAMPLE, '.env': 'PAYMENT_KEY=live_key_value\n' });
    const report = await scanRepository({ root, skipServices: true, skipRuntimes: true });
    const paymentKey = report.config.find((entry) => entry.name === 'PAYMENT_KEY');

    expect(paymentKey?.status).toBe('set');
    expect(paymentKey?.setBy).toBe('.env');
  });

  it('renders a report and an env example from the same scan', async () => {
    const report = await scanSample();

    const text = renderReport(report, { verbose: false });
    expect(text).toContain('PAYMENT_KEY');
    expect(text).toContain('required, not set');

    const example = renderEnvExample(report);
    expect(example).toContain('PAYMENT_KEY=');
    // Values with fallbacks are commented out — they are optional.
    expect(example).toContain('# PORT=');
  });
});

describe('argument parsing', () => {
  it('reads flags and an optional path', () => {
    const flags = parseArgs(['--json', '--no-services', 'some/repo']);
    expect(flags.json).toBe(true);
    expect(flags.services).toBe(false);
    expect(flags.root.endsWith('repo')).toBe(true);
  });

  it('defaults to the working directory with probes enabled', () => {
    const flags = parseArgs([]);
    expect(flags.root).toBe(process.cwd());
    expect(flags.services).toBe(true);
    expect(flags.json).toBe(false);
  });
});
