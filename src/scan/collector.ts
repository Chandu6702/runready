import type { ConfigScope, ConfigVar, Ecosystem, SourceRef } from '../types.js';

/** Deploy-time ecosystems: needed to ship, not to run the app locally. */
const DEPLOY_ECOSYSTEMS = new Set<Ecosystem>(['terraform']);

function scopeOf(ecosystem: Ecosystem): ConfigScope {
  return DEPLOY_ECOSYSTEMS.has(ecosystem) ? 'deploy' : 'runtime';
}

/**
 * Merges variable sightings from every scanner. The same name can appear in
 * several files (and ecosystems) — the merged entry keeps all source
 * references, and is only "required" when no scanner found a fallback.
 */
export class ConfigCollector {
  private readonly vars = new Map<string, ConfigVar>();

  add(entry: {
    name: string;
    ecosystem: Ecosystem;
    defaultValue?: string;
    required?: boolean;
    source: SourceRef;
  }) {
    const name = entry.name.trim();
    if (!name || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) {
      return;
    }

    const existing = this.vars.get(name);
    if (!existing) {
      this.vars.set(name, {
        name,
        ecosystem: entry.ecosystem,
        scope: scopeOf(entry.ecosystem),
        defaultValue: entry.defaultValue,
        required: entry.required ?? entry.defaultValue === undefined,
        sources: [entry.source],
      });
      return;
    }

    existing.sources.push(entry.source);
    if (existing.defaultValue === undefined && entry.defaultValue !== undefined) {
      existing.defaultValue = entry.defaultValue;
    }
    // A default anywhere means the app can boot without the value.
    if (entry.defaultValue !== undefined || entry.required === false) {
      existing.required = false;
    }
    // Referenced by runtime code as well as deploy tooling → runtime wins.
    if (scopeOf(entry.ecosystem) === 'runtime') {
      existing.scope = 'runtime';
    }
  }

  all(): ConfigVar[] {
    return [...this.vars.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
