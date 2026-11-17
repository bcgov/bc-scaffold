# Remediation verification

Verification runs after review and grouping. It resolves proposed upgrades together per declaration manifest in temporary snapshots, leaving the checkout unchanged.

[Architecture](../../../README.md#architecture) · [Agents and tools](../../../AGENTS_AND_TOOLS.md)

## Candidate selection

- Duplicate recommendations share one package pin drawn from their common qualifying versions. The first common candidate in recommendation order is tried.
- Failed candidates may retry at a shared reviewed compatible version, alongside accepted upgrades.
- Successful versions populate `triage.verified_versions` and produce Renovate rules. Failed or unsupported recommendations remain unresolved, with diagnostics in the plan.

## Verification status

Each candidate records `isVerified`, `verification_status`, and an optional diagnostic in `verification_message`.

| Status | Meaning |
| --- | --- |
| `SUCCESS` | The candidate resolved with the accepted upgrade set; `isVerified` is `true`. |
| `FAILED` | Resolution failed, verification was unsupported, or inputs, tools, or time were unavailable; `isVerified` is `false`. Check the diagnostic for the reason. |
| Unset | The candidate was not attempted; `isVerified` remains `false`. |

`triage.verified_versions[package]` holds the accepted version, or `None` when unresolved. A failed initial candidate can remain `FAILED` even when a fallback succeeds.

Unsupported verification is retained as a failed candidate internally with a diagnostic, but consolidated issue rows display **NOT VERIFIED** rather than a dependency conflict.

## Engines

### npm

Resolve the original manifest first, then pin upgrades using the same peer policy:

```text
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps=false
```

A root/project `.npmrc` setting of `legacy-peer-deps=true` selects legacy mode, with project settings taking precedence. Otherwise, only a baseline `ERESOLVE` failure triggers a legacy retry:

```text
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --legacy-peer-deps
```

A failed baseline stops verification. Legacy mode is disclosed in notes. Success means npm exited successfully; the lockfile graph is not inspected.

### Yarn Classic

Standalone projects with a Classic `yarn.lock` use the exact declared Yarn 1.x version, or 1.22.22 when `packageManager` is absent. npm-labelled findings are routed by the manifest's package manager or Yarn lockfile.

```text
npx --yes yarn@<1.x-version> install --ignore-scripts --non-interactive --production=false --no-progress
```

Candidates are pinned together in the temporary manifest. The engine checks their exact versions in installed `node_modules` package manifests. Installation may download packages, but project and dependency scripts are disabled. Peer warnings do not fail Yarn Classic verification; this limitation is recorded in notes.

Berry, workspaces, Plug'n'Play, local/path dependencies, and projects requiring repository `.yarnrc`, `.yarnrc.yml`, or `.npmrc` configuration are unsupported. Repository configuration is not silently discarded.

### Python

Compile requirements or supported PEP 621 inputs with exact candidate constraints:

```text
uv pip compile <manifest> --constraint .remediation-constraints.txt --only-binary :all: --output-file .remediation-resolved.txt
```

Selected requirement specifiers are replaced; PEP 621 declarations must permit the constraints. The output must contain the requested versions.

### NuGet

Installed prerelease versions are valid starting points. NuGet automatically prefers stable security candidates and falls back to same-major prereleases only when no stable candidate qualifies. Fallbacks are labelled in the plan and compatibility table and must pass the same resolution checks before generating Renovate rules. This behavior has no configuration switch. Unsupported central package management still prevents verification.

Pin inline project references and restore, treating downgrade and constraint warnings as errors:

```text
dotnet restore <project> --nologo --verbosity minimal -p:EnableWindowsTargeting=true -p:WarningsAsErrors=NU1605%3BNU1608
```

The staged lockfile is removed before restore. Requested versions must appear in `obj/project.assets.json`.

## Limits

- Snapshots contain one manifest and its available lockfile. Workspace siblings, local dependencies, shared build files, and private registry configuration are not staged.
- Yarn Berry, Yarn workspaces and Plug-and-Play, pnpm-native projects, native Poetry, uv workspaces, and NuGet central versions without inline overrides are unsupported.
- Each command has up to five minutes within a fifteen-minute manifest verification budget. Timed-out workers cannot publish results.
- Resolution may access registries. It checks dependency resolution on the runner; application builds, tests, and independent security scans remain separate.
