import path from 'node:path';
import { collectLocalValues, resolveConfig } from '../resolve/env.js';
import { checkRuntimes } from '../resolve/runtimes.js';
import { findSecrets } from '../resolve/secrets.js';
import { detectServices } from '../resolve/services.js';
import type { Ecosystem, ScanOptions, ScanReport } from '../types.js';
import { ConfigCollector } from './collector.js';
import { scanCompose, scanDockerfiles } from './docker.js';
import { scanEnvExamples } from './dotenv.js';
import { scanNode } from './node.js';
import { scanSpring } from './spring.js';
import { scanTerraform } from './terraform.js';

export async function scanRepository(options: ScanOptions): Promise<ScanReport> {
  const root = path.resolve(options.root);
  const collector = new ConfigCollector();
  const ecosystems: Ecosystem[] = [];

  const detected = await Promise.all([
    scanNode(root, collector).then((found) => (found ? 'node' : null)),
    scanSpring(root, collector).then((found) => (found ? 'spring' : null)),
    scanDockerfiles(root, collector).then((found) => (found ? 'docker' : null)),
    scanCompose(root, collector).then((found) => (found ? 'compose' : null)),
    scanTerraform(root, collector).then((found) => (found ? 'terraform' : null)),
    scanEnvExamples(root, collector).then((found) => (found ? 'dotenv' : null)),
  ]);
  for (const entry of detected) {
    if (entry) {
      ecosystems.push(entry);
    }
  }

  const [local, services, runtimes, secrets] = await Promise.all([
    collectLocalValues(root),
    detectServices(root, options.skipServices ?? false),
    options.skipRuntimes ? Promise.resolve([]) : checkRuntimes(root),
    findSecrets(root),
  ]);

  return {
    root,
    projectName: path.basename(root),
    ecosystems,
    config: resolveConfig(collector.all(), local),
    services,
    runtimes,
    secrets,
  };
}

/**
 * Issues that stop the app from running here and now. Deploy-time inputs are
 * reported but never block — you don't need Terraform variables to start the
 * app on your laptop.
 */
export function blockingIssues(report: ScanReport): number {
  const missing = report.config.filter(
    (entry) => entry.status === 'missing' && entry.scope === 'runtime',
  ).length;
  const unreachable = report.services.filter((service) => !service.reachable).length;
  const unsatisfied = report.runtimes.filter((runtime) => !runtime.satisfied).length;
  const leaked = report.secrets.filter((secret) => secret.committed).length;
  return missing + unreachable + unsatisfied + leaked;
}
