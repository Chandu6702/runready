import pc from 'picocolors';
import type { ResolvedConfigVar, ScanReport } from '../types.js';
import { blockingIssues } from '../scan/index.js';

const OK = pc.green('✓');
const WARN = pc.yellow('!');
const FAIL = pc.red('✗');

function heading(text: string) {
  return `\n${pc.bold(text)}`;
}

function pad(text: string, width: number) {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function where(entry: ResolvedConfigVar): string {
  const first = entry.sources[0];
  if (!first) {
    return '';
  }
  const extra = entry.sources.length > 1 ? ` (+${entry.sources.length - 1})` : '';
  return pc.dim(`${first.file}:${first.line}${extra}`);
}

export function renderReport(report: ScanReport, options: { verbose: boolean }): string {
  const lines: string[] = [];
  const stacks = report.ecosystems.length ? report.ecosystems.join(', ') : 'unknown';
  lines.push(`${pc.bold(pc.cyan('runready'))} ${pc.dim('·')} ${report.projectName} ${pc.dim(`(${stacks})`)}`);

  if (report.runtimes.length) {
    lines.push(heading('Runtimes'));
    for (const runtime of report.runtimes) {
      const mark = runtime.satisfied ? OK : FAIL;
      const detail = runtime.installed
        ? `found ${runtime.installed}`
        : pc.red('not found on PATH');
      lines.push(`  ${mark} ${pad(`${runtime.name} ${runtime.expected}`, 24)} ${detail}`);
    }
  }

  const runtime = report.config.filter((entry) => entry.scope === 'runtime');
  const deploy = report.config.filter((entry) => entry.scope === 'deploy');
  const missing = runtime.filter((entry) => entry.status === 'missing');
  const defaulted = runtime.filter((entry) => entry.status === 'defaulted');
  const set = runtime.filter((entry) => entry.status === 'set');

  if (runtime.length) {
    lines.push(heading(`Configuration ${pc.dim(`(${runtime.length} values)`)}`));

    for (const entry of missing) {
      lines.push(`  ${FAIL} ${pad(entry.name, 24)} ${pc.red('required, not set')} ${where(entry)}`);
    }
    for (const entry of defaulted) {
      const preview = entry.defaultValue ? `"${entry.defaultValue}"` : 'built-in';
      lines.push(
        `  ${WARN} ${pad(entry.name, 24)} ${pc.yellow(`using default ${preview}`)} ${where(entry)}`,
      );
    }
    if (options.verbose) {
      for (const entry of set) {
        lines.push(`  ${OK} ${pad(entry.name, 24)} ${pc.dim(`set in ${entry.setBy}`)}`);
      }
    } else if (set.length) {
      lines.push(`  ${OK} ${pc.dim(`${set.length} value(s) already provided`)}`);
    }
  }

  if (deploy.length) {
    const unset = deploy.filter((entry) => entry.status === 'missing');
    lines.push(heading(`Deploy-time inputs ${pc.dim('(not needed to run locally)')}`));
    if (options.verbose) {
      for (const entry of deploy) {
        const state = entry.status === 'missing' ? pc.dim('supply at deploy time') : pc.dim(entry.status);
        lines.push(`  ${pc.dim('·')} ${pad(entry.name, 24)} ${state} ${where(entry)}`);
      }
    } else {
      lines.push(
        `  ${pc.dim('·')} ${pc.dim(
          `${deploy.length} value(s)${unset.length ? `, ${unset.length} to supply when deploying` : ''}`,
        )}`,
      );
    }
  }

  if (report.services.length) {
    lines.push(heading('Services'));
    for (const service of report.services) {
      const address = `${service.host}:${service.port}`;
      if (service.reachable) {
        lines.push(`  ${OK} ${pad(service.kind, 24)} ${pc.dim(`${address} reachable`)}`);
      } else {
        lines.push(`  ${FAIL} ${pad(service.kind, 24)} ${pc.red(`${address} not reachable`)}`);
      }
    }
  }

  if (report.secrets.length) {
    lines.push(heading('Secrets'));
    for (const secret of report.secrets) {
      const location = `${secret.source.file}:${secret.source.line}`;
      if (secret.committed) {
        lines.push(
          `  ${FAIL} ${pad(secret.kind, 24)} ${pc.red('in a tracked file')} ${pc.dim(`${location} → ${secret.preview}`)}`,
        );
      } else if (options.verbose) {
        lines.push(
          `  ${OK} ${pad(secret.kind, 24)} ${pc.dim(`git-ignored — ${location}`)}`,
        );
      }
    }
    const ignored = report.secrets.filter((secret) => !secret.committed).length;
    if (ignored && !options.verbose) {
      lines.push(`  ${OK} ${pc.dim(`${ignored} secret(s) safely git-ignored`)}`);
    }
  }

  const blocking = blockingIssues(report);
  lines.push('');
  if (blocking === 0) {
    lines.push(pc.green(pc.bold('Ready to run.')));
  } else {
    lines.push(pc.red(pc.bold(`${blocking} issue(s) to fix before this repo will run.`)));
    if (missing.length) {
      lines.push(pc.dim('Tip: runready --init writes a .env.example with everything above.'));
    }
  }

  return lines.join('\n');
}
