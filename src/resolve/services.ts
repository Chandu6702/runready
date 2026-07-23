import net from 'node:net';
import { eachLine, listFiles, readIfPresent } from '../util/files.js';
import type { ServiceRequirement, SourceRef } from '../types.js';

/** Connection strings that reveal a backing service and its port. */
const URL_PATTERNS: { kind: string; pattern: RegExp; defaultPort: number }[] = [
  { kind: 'postgresql', pattern: /jdbc:postgresql:\/\/([\w.-]+)(?::(\d+))?/g, defaultPort: 5432 },
  { kind: 'postgresql', pattern: /postgres(?:ql)?:\/\/(?:[^@\s]+@)?([\w.-]+)(?::(\d+))?/g, defaultPort: 5432 },
  { kind: 'mysql', pattern: /jdbc:mysql:\/\/([\w.-]+)(?::(\d+))?/g, defaultPort: 3306 },
  { kind: 'mongodb', pattern: /mongodb(?:\+srv)?:\/\/(?:[^@\s]+@)?([\w.-]+)(?::(\d+))?/g, defaultPort: 27017 },
  { kind: 'redis', pattern: /redis:\/\/(?:[^@\s]+@)?([\w.-]+)(?::(\d+))?/g, defaultPort: 6379 },
];

/** Only probe addresses that belong to this machine. */
function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

function probe(host: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (reachable: boolean) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host === '0.0.0.0' ? '127.0.0.1' : host);
  });
}

export async function detectServices(root: string, skipProbe: boolean): Promise<ServiceRequirement[]> {
  const files = await listFiles(root, [
    '**/application*.{yml,yaml,properties}',
    '**/*local.{yml,yaml,properties}',
    '**/.env*',
    '**/docker-compose*.{yml,yaml}',
    '**/compose*.{yml,yaml}',
    '**/*.{ts,js,mjs,cjs}',
  ]);

  const found = new Map<string, { kind: string; host: string; port: number; sources: SourceRef[] }>();

  for (const file of files) {
    const contents = await readIfPresent(file.absolute);
    if (!contents) {
      continue;
    }

    eachLine(contents, (line, lineNumber) => {
      for (const { kind, pattern, defaultPort } of URL_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line))) {
          const host = match[1] ?? 'localhost';
          if (!isLocal(host)) {
            continue; // remote/hosted database — nothing to start locally
          }
          const port = Number(match[2] ?? defaultPort);
          const key = `${kind}:${host}:${port}`;
          const entry = found.get(key);
          const source = { file: file.relative, line: lineNumber };
          if (entry) {
            entry.sources.push(source);
          } else {
            found.set(key, { kind, host, port, sources: [source] });
          }
        }
      }
    });
  }

  const services = [...found.values()];
  if (skipProbe) {
    return services.map((service) => ({ ...service, reachable: false }));
  }

  return Promise.all(
    services.map(async (service) => ({
      ...service,
      reachable: await probe(service.host, service.port),
    })),
  );
}
