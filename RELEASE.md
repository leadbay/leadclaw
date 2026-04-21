# Release runbook

All releases are tag-driven. **Never run `npm publish` locally.** The GitHub Actions workflow in `.github/workflows/release.yml` owns publishing, and it verifies tag ↔ version ↔ manifest agreement before each publish.

## One-time setup (already done, but for the record)

Repo secrets (Settings → Secrets and variables → Actions):

- `NPM_TOKEN` — npm automation token with publish rights on the `@leadbay` scope.
- `CLAWHUB_TOKEN` — ClawHub publish token with rights on the `@leadbay` namespace.

npm scope: `@leadbay` must exist with publish rights for the NPM_TOKEN holder (create at <https://www.npmjs.com/org/create> if not yet).

## Release `@leadbay/mcp`

1. On a branch, bump `packages/mcp/package.json#version` (e.g. `0.2.0` → `0.3.0`).
2. Add a note to `packages/mcp/CHANGELOG.md`.
3. PR → `main`, land.
4. Tag the merge commit and push:
   ```bash
   git checkout main && git pull
   git tag mcp-v0.3.0
   git push origin mcp-v0.3.0
   ```
5. Watch the `release` workflow in Actions. It runs `preflight-npm` → `publish-mcp` (build + test + tag/version check + `npm publish --access public --provenance`).

## Release `@leadbay/leadclaw`

The leadclaw version must match in **three** places: `package.json`, `openclaw.plugin.json`, and the git tag. The workflow fails fast if they disagree.

1. Bump `packages/leadclaw/package.json#version` AND `packages/leadclaw/openclaw.plugin.json#version` to the same value.
2. Add a note to `packages/leadclaw/CHANGELOG.md`.
3. PR → `main`, land.
4. Tag the merge commit and push:
   ```bash
   git checkout main && git pull
   git tag leadclaw-v0.3.0
   git push origin leadclaw-v0.3.0
   ```
5. Watch the `release` workflow. It runs `preflight-npm` → `publish-leadclaw` (build + test + version-parity check + `npm publish` + `clawhub login` + `clawhub package publish`).

Order matters: npm **before** ClawHub. OpenClaw's install path resolves `@leadbay/leadclaw` via npm (`install.npmSpec`), so a ClawHub entry pointing at a missing npm version would break installs.

## Manual dry run

Actions → `release` → "Run workflow" → pick `package: mcp | leadclaw`, set `dry_run: true`. The npm half runs `npm publish --dry-run`. ClawHub is skipped on dry runs (the CLI has no dry-run mode).

## Debugging a failed release

- **`E404 Scope not found`** from `preflight-npm` → `@leadbay` org doesn't exist yet. Create at <https://www.npmjs.com/org/create>. Re-run the workflow from the Actions UI (no re-tag needed).
- **`E403`** from `publish-*` → token lacks publish rights on the scope. Regenerate the automation token with scope-owner rights, update `NPM_TOKEN`, re-run.
- **"Version drift: tag=X pkg=Y manifest=Z"** → bump the laggard(s) in a new PR, tag the new commit.
- **`clawhub login` failure** → check `CLAWHUB_TOKEN` is valid with `clawhub whoami` locally (using the same token).
- **`clawhub package publish` failure** → the CLI surfaces the HTTP error. Common causes: source-repo/source-commit mismatch (shouldn't happen, the workflow passes these from GitHub env), or the `leadbay` namespace rights missing on ClawHub.

If a publish half-succeeds (npm ships but ClawHub fails, or vice versa), fix the underlying issue and re-run the failing job from the Actions UI; do not retag the same version.

## No automatic version bumping, no changesets

Versioning is manual — the cost of getting it wrong is a red CI run, not a wrong release. Two packages at this scale doesn't justify automation overhead. Revisit if the package count grows.
