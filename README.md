# runready

[![CI](https://github.com/Chandu6702/runready/actions/workflows/ci.yml/badge.svg)](https://github.com/Chandu6702/runready/actions/workflows/ci.yml)

**Know what a repository needs before you run it.**

You clone a repo, run it, and get `ECONNREFUSED`. Then a missing environment
variable. Then a database that isn't running. Twenty minutes gone, and the
README never mentioned any of it — because the person who wrote it already had
everything configured.

`runready` reads the actual source — not just `.env.example` — and tells you in
one second what the project needs, what you're missing, and whether a real
credential is sitting in a file git is about to publish.

```bash
npx runready
```

```
runready · checkout-service (node)

Runtimes
  ✓ Node.js >=22             found 24.14.0

Configuration (3 values)
  ✗ DATABASE_URL             required, not set      src/server.ts:1
  ✗ STRIPE_SECRET_KEY        required, not set      src/server.ts:2
  ! PORT                     using default "3000"   src/server.ts:3

Services
  ✗ redis                    localhost:6379 not reachable

Secrets
  ✗ password                 in a tracked file      config.yml:2 → Mai**********26

4 issue(s) to fix before this repo will run.
Tip: runready --init writes a .env.example with everything above.
```

## What it checks

| | |
|---|---|
| **Configuration** | Every value the code actually reads — `process.env.X` and `import.meta.env.X` in JS/TS, `${VAR:default}` in Spring YAML/properties and `@Value`, `ARG`/`ENV` in Dockerfiles, `${VAR:-default}` in Compose, `variable` blocks in Terraform, and declarations in `.env.example`. Each one is reported as **set**, **using a default**, or **missing**, with the file and line where it's read. |
| **Services** | Databases and caches inferred from connection strings (PostgreSQL, MySQL, MongoDB, Redis). Local addresses are probed over TCP, so you find out Postgres isn't running *before* the stack trace. |
| **Runtimes** | Required versions from `engines.node`, `.nvmrc`, `<java.version>` in `pom.xml`, and `go.mod`, compared against what's installed. |
| **Secrets** | Credentials that look real — provider key formats, private keys, connection-string and `password:` assignments. The finding that matters is **"in a tracked file"**: the same value in a git-ignored file is correct practice, and is reported as safe. |

## Design decisions

**Read the code, not the documentation.** `.env.example` files go stale the
moment someone adds a variable and forgets to update them. Source doesn't.

**Deploy-time inputs never block local development.** Terraform variables and
build args are real requirements, but you don't need them to start the app on
your laptop — they're reported separately and excluded from the exit code.

**A secret is only an incident if git can see it.** Every secret scanner finds
strings; the useful signal is whether the file is tracked. `runready` asks git
directly (`git ls-files`), and falls back to `.gitignore` rules outside a repo
or before the first commit.

**False positives make a tool worthless.** Type annotations (`password: string`),
value references (`var.db_password`, `process.env.DB_PASSWORD`), placeholders,
example files, comments and test fixtures are all excluded — each rule added
after the tool flagged something it shouldn't have on a real repository.

## Usage

```bash
npx runready [path]        # scan a repository (defaults to the current one)
npx runready --init        # write the .env.example the repo should have shipped
npx runready --json        # machine-readable output
npx runready --verbose     # also list values that are already provided
npx runready --no-services # skip TCP probes (offline or CI)
```

Exit code is `0` when the project can run and `1` when something is missing —
so it works as a CI gate that fails when someone adds configuration without
documenting it:

```yaml
- run: npx runready --no-services
```

## Install

```bash
npm install -g runready   # or just use npx
```

Requires Node 18+. No configuration, no network calls, nothing sent anywhere —
it only reads files and opens local TCP connections.

## Development

```bash
npm install
npm test          # vitest
npm run dev -- .  # run against a repo without building
npm run build
```

Tests build throwaway repositories in a temp directory rather than committing
fixture files, so this repository never contains anything that looks like a
leaked credential.

## License

[MIT](LICENSE)
