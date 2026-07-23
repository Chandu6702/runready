/** Where a requirement was discovered. */
export interface SourceRef {
  file: string;
  line: number;
}

export type Ecosystem = 'node' | 'spring' | 'docker' | 'compose' | 'terraform' | 'dotenv';

/**
 * When a value is needed. Deploy-time inputs (Terraform variables, build
 * args) must not block someone who only wants to run the app locally.
 */
export type ConfigScope = 'runtime' | 'deploy';

/** A configuration value the project reads. */
export interface ConfigVar {
  name: string;
  ecosystem: Ecosystem;
  scope: ConfigScope;
  /** Inline fallback found in source, e.g. ${DB_URL:localhost}. */
  defaultValue?: string;
  /** True when the code cannot start without it. */
  required: boolean;
  sources: SourceRef[];
}

export type ConfigStatus = 'set' | 'defaulted' | 'missing';

export interface ResolvedConfigVar extends ConfigVar {
  status: ConfigStatus;
  /** Human-readable origin of the value: "environment", ".env", … */
  setBy?: string;
}

export interface ServiceRequirement {
  kind: string;
  host: string;
  port: number;
  reachable: boolean;
  sources: SourceRef[];
}

export interface RuntimeRequirement {
  name: string;
  expected: string;
  installed?: string;
  satisfied: boolean;
  source: SourceRef;
}

export interface SecretFinding {
  kind: string;
  source: SourceRef;
  /** Masked preview — the real value is never printed or stored. */
  preview: string;
  /** True when the file is tracked by git (i.e. actually exposed). */
  committed: boolean;
}

export interface ScanReport {
  root: string;
  projectName: string;
  ecosystems: Ecosystem[];
  config: ResolvedConfigVar[];
  services: ServiceRequirement[];
  runtimes: RuntimeRequirement[];
  secrets: SecretFinding[];
}

export interface ScanOptions {
  root: string;
  /** Skip TCP probes (offline / CI use). */
  skipServices?: boolean;
  /** Skip runtime version checks. */
  skipRuntimes?: boolean;
}
