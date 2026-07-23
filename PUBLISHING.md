# Publishing runready to npm

Everything the package needs is already in place — this is the checklist for
the day you decide to press the button.

## What's already done

`package.json` is publish-ready:

| Field | Value | Why it matters |
|---|---|---|
| `bin` | `runready → dist/cli.js` | npm symlinks this into PATH, so `npx runready` works |
| `files` | `["dist"]` | Only compiled output ships — no `src/`, tests, or config |
| `engines` | `node >= 18` | npm warns users on unsupported Node versions |
| `prepublishOnly` | `npm run build` | Impossible to publish stale or missing `dist/` |
| `repository`, `license`, `keywords` | set | Shown on the npm package page |

## Requirements (one-time)

1. **An npm account** — sign up at npmjs.com, then log in from the terminal:

   ```bash
   npm login
   ```

2. **A free name.** Check whether `runready` is taken:

   ```bash
   npm view runready
   ```

   - `404` → the name is free, publish as-is.
   - Package info appears → the name is taken. Two options:
     - pick a new name (`runready-cli`, …) and update `name` + `bin`, or
     - publish under your scope: set `"name": "@chandu6702/runready"`.
       Scoped packages are private by default, so publish with
       `npm publish --access public`. `npx @chandu6702/runready` then works
       for everyone; the `bin` entry still installs the `runready` command.

## Dry run first

See exactly what would be uploaded without uploading anything:

```bash
npm pack --dry-run
```

Expect only `dist/**`, `package.json`, `README.md`, and `LICENSE`. To test the
real install experience end-to-end:

```bash
npm pack
npm install -g ./runready-0.1.0.tgz
runready            # run it against some repo
npm uninstall -g runready
```

## Publish

```bash
npm publish          # add --access public if the name is scoped
```

That's it — `prepublishOnly` builds automatically first. Verify at
`https://www.npmjs.com/package/runready` and smoke-test with `npx runready`.

## Releasing updates

npm refuses to publish the same version twice. Bump with semver:

```bash
npm version patch    # bug fix        0.1.0 -> 0.1.1
npm version minor    # new feature    0.1.1 -> 0.2.0
npm version major    # breaking change
git push --follow-tags
npm publish
```

Rule of thumb: `patch` = fixes, `minor` = new checks/flags that don't break
existing usage, `major` = changed flags or output format that scripts might
depend on. Stay `0.x` until you consider the CLI stable — semver treats 0.x
as "anything may change".

## Good practice before the first publish

- Make sure `README.md` opens with an install/usage snippet
  (`npx runready`) — it doubles as the npm page.
- Tag the release on GitHub so the npm version and a git tag line up:
  `git tag v0.1.0 && git push --tags`.
- Never publish secrets: `files: ["dist"]` already protects you, but
  `npm pack --dry-run` before every publish is a cheap habit.
