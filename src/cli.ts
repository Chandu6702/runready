#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { renderEnvExample } from './report/envExample.js';
import { renderReport } from './report/terminal.js';
import { blockingIssues, scanRepository } from './scan/index.js';

const HELP = `
${pc.bold('runready')} — know what a repository needs before you run it

${pc.bold('Usage')}
  runready [path] [options]

${pc.bold('Options')}
  --init            write a .env.example covering every value the code reads
  --json            machine-readable output
  --verbose, -v     list values that are already provided
  --no-services     skip TCP probes for databases and caches
  --no-runtimes     skip runtime version checks
  --help, -h        show this message

${pc.bold('Exit codes')}
  0  ready to run
  1  something is missing (use in CI to catch undocumented config)
`;

interface Flags {
  root: string;
  init: boolean;
  json: boolean;
  verbose: boolean;
  services: boolean;
  runtimes: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    root: process.cwd(),
    init: false,
    json: false,
    verbose: false,
    services: true,
    runtimes: true,
    help: false,
  };

  for (const arg of argv) {
    switch (arg) {
      case '--init':
        flags.init = true;
        break;
      case '--json':
        flags.json = true;
        break;
      case '--verbose':
      case '-v':
        flags.verbose = true;
        break;
      case '--no-services':
        flags.services = false;
        break;
      case '--no-runtimes':
        flags.runtimes = false;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          flags.root = path.resolve(arg);
        }
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  const report = await scanRepository({
    root: flags.root,
    skipServices: !flags.services,
    skipRuntimes: !flags.runtimes,
  });

  if (flags.init) {
    const target = path.join(report.root, '.env.example');
    await writeFile(target, renderEnvExample(report), 'utf8');
    console.log(`${pc.green('✓')} wrote ${path.relative(process.cwd(), target) || '.env.example'}`);
    return 0;
  }

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report, { verbose: flags.verbose }));
  }

  return blockingIssues(report) === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(pc.red('runready failed:'), error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
