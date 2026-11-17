# Agents and tools

[Back to the architecture diagram](README.md#architecture).

## Agents

| Agent | Responsibility |
| --- | --- |
| `VulnerabilityCollectorAgent` | Collect Dependabot and selected code-scanning alerts; record counts and collection errors. |
| `ArtifactCollectorAgent` | Collect the repository reference, open bot PRs, manifests, and lockfiles. |
| `VulnerabilityTriageAgent` | Group package alerts, trace vulnerable occurrences and parent dependencies, identify upgrade targets, and match existing PRs. |
| `VulnerabilityReviewerAgent` | Dispatch npm, Python, and .NET reviewers to enrich upgrade candidates before final grouping. Review does not establish successful dependency resolution. |
| `RemediationPlannerAgent` | Group reviewed findings using supported Renovate rules or fallback groups, and consolidate upgrade targets. |
| `RemediationVerificationAgent` | Resolve supported candidates together per project in disposable snapshots; record verified versions and failure diagnostics. |
| `RemediationArtifactAgent` | Export the full plan, retain unresolved findings, and generate Renovate rules for verified recommendations. |

## Tools

| Component | Responsibility |
| --- | --- |
| `dependabot_alerts_tool` / `codescanning_alerts_tool` | Read GitHub security alerts. Code-scanning findings contribute to the summary; Dependabot findings drive package triage. |
| `pull_requests_tool` | Read bot PRs and extract proposed version changes for matching against upgrade targets. |
| `get_repository_context` | Read repository metadata and security-feature availability. |
| `ManifestTool` | Read and cache repository manifests, lockfiles, and configuration for shared use across stages. |

## Resolvers

Renovate grouping matches upgrade targets (including parents of vulnerable transitive dependencies). Supported local rules use `matchPackageNames`, `matchManagers`, `matchDatasources`, and `matchUpdateTypes`; name matching supports exact names, simple globs, `/regex/` patterns, and exclusions. Later matching group rules take precedence. Inherited `extends` presets are not resolved, and unsupported selectors are skipped with warnings. Findings whose targets span different groups stay in `default` with a warning to avoid duplicating alert counts.

Resolvers establish which dependency introduces a vulnerable package and which upgrades could address it.

### Relationship resolvers

Trace the current dependency graph to report installed versions, direct dependencies, and parent paths such as `app -> parent -> vulnerable package`.

| Resolver | Under the hood |
| --- | --- |
| npm | Read the dependency tree from `package.json` and `package-lock.json` using the npm CLI. |
| Yarn | Classic traverses the full `yarn list` graph from declared dependencies, resolving hoisted references with exact versions. Berry uses `yarn why`. Intermediate dependencies remain in paths rather than becoming upgrade targets. |
| pip | Resolve requirements into a pip dry-run report and reconstruct dependency paths from package metadata. |
| Poetry | Trace locked dependency paths from `pyproject.toml` and `poetry.lock`; markers are not evaluated. |
| NuGet | Restore staged projects and read dependency paths per target framework from `obj/project.assets.json`. |

Commands used in temporary snapshots (`<packages>` and paths are supplied by the workflow):

#### npm

```text
npm ls <packages> --all --package-lock-only --json --offline --ignore-scripts --no-audit --no-fund
```

#### Yarn 2+

```text
yarn why <package> --recursive --json
```

#### Yarn Classic

Read the complete versioned tree once per batch; filtering by package would omit hoisted edges:

```text
yarn list --json
```

Paths start at declared dependencies and follow the nearest installed version for each edge. Traversal and representative paths are bounded to prevent dependency cycles and large graphs from exhausting the run.

#### pip

Uses the runner's Python interpreter:

```text
python -m pip install --dry-run --ignore-installed --report <report.json> -r <requirements.txt>
```

#### Poetry

Prefers `uv tool run poetry`; falls back to `poetry` on PATH:

```text
uv tool run poetry show <package> --tree --why
```

#### NuGet

```text
dotnet restore <project> --nologo --verbosity minimal
```

### Recommendation resolvers

Find direct-package or parent-package upgrade targets whose dependency metadata addresses the vulnerable range. These candidates still need review and resolution verification.

| Resolver | Evidence used |
| --- | --- |
| npm | npm registry releases and dependency metadata to shortlist parent upgrades. |
| Python | PyPI releases and `requires_dist` metadata to shortlist parent upgrades. |
| .NET | NuGet release and dependency-group metadata to infer suitable upgrades. |

These resolvers use HTTP registry APIs through `httpx`, with no shell command:

#### npm

```text
https://registry.npmjs.org/{name}
```

#### Python

```text
https://pypi.org/pypi/{name}/json
https://pypi.org/pypi/{name}/{version}/json
```

#### .NET

```text
https://api.nuget.org/v3/registration5-gz-semver2/{name}/index.json
https://api.nuget.org/v3-flatcontainer/{name}/index.json
```

## Reviewers

Reviewers enrich candidate versions before the planner groups findings. They preserve security-fix evidence and can include optional non-vulnerable updates. A review suggestion does not establish that upgrades resolve together.

| Reviewer | Under the hood |
| --- | --- |
| `NpmCompatibleVersionReviewer` | Run `npm-check-updates` against an isolated manifest, considering peer dependencies and Node engine requirements. |
| `PythonCompatibleVersionReviewer` | Select requirements, uv, or Poetry tooling by manifest format and collect supported compatible-version suggestions. |
| `DotNetCompatibleVersionReviewer` | Use the NuGet recommendation resolver to collect stable same-major candidates; no reviewer CLI is run. |

Commands used in temporary directories:

### npm reviewer

`-u` changes only the temporary `package.json`. The empty reject argument reflects the current exclusion list. Add `--filter <packages>` to limit review to selected packages.

```text
npx --yes npm-check-updates@23.1.0 --target latest --peer --enginesNode --reject "" -u
```

### Python requirements reviewer

Uses `pcu` on PATH, or this `uvx` fallback:

```text
uvx --from pip-check-updates pcu requirements.txt -t minor -x --no_color --no_recursive
```

### uv project reviewer

Add repeated `--upgrade-package <package>` arguments to limit review to selected packages.

```text
uvx uv-upsync --max-bump minor --dry-run --format json --all-groups --color never
```

### Poetry project reviewer

Requires `poetry-plugin-up`. Append `-- <packages>` to limit review to selected packages.

```text
poetry up --dry-run --no-ansi --no-interaction
```

### .NET reviewer

Installed prerelease versions do not block stable-release review. NuGet security candidate selection prefers stable fixes; automatic prerelease fallback is documented under [verification](src/engines/remediation_verification/README.md#nuget).

Uses the NuGet registry APIs listed under recommendation resolvers; no reviewer CLI is run.

## Verification engines

After review and grouping, verification resolves proposed upgrades together per project using npm or Yarn Classic installs, `uv pip compile`, or `dotnet restore`. Supported verification formats are narrower than relationship-resolution support. See [remediation verification](src/engines/remediation_verification/README.md) for commands, candidate rules, and limits.

