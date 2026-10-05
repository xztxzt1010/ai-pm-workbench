# Public Snapshot Manifest · v0.2.0 Source Preview

## Source

| Field | Value |
|---|---|
| Source commit | `0dee7c6` (internal freeze + sidecar ready-gate fix + @mastra/core removal + 0.2.0 metadata gate) |
| Snapshot method | allowlist export of tracked files only |
| Public branch | `public/v0.2.0-source-preview` (created from `origin/main@1ae118e`) |
| History policy | public branch is a clean tree commit; no development-repo history is merged |
| License | MIT (Copyright 2026 xztxzt1010) |
| Version | 0.2.0 Source Preview |
| Installer assets | 0 (no supported Windows installer) |

## Included categories

| Category | Rule | Approx. count |
|---|---|---|
| Frontend source (`src/`) | all tracked TypeScript/TSX and tests | 236 |
| Desktop shell (`src-tauri/`) | Rust source, migrations, icons, config; no `target/` | 70 |
| Sidecar (`sidecar/`) | Node source and tests; no `node_modules/`, `.sea/`, `bin/` | 10 |
| Verification scripts (`scripts/`) | public verify/build helpers only | 17 |
| Examples (`examples/`) | sample meeting/research/CSV fixtures | 4 |
| Performance (`performance/`) | bundle/performance budget tests | 1 |
| Visual fixtures (`visual/`) | chart preview HTML/TS | 2 |
| Root toolchain | package manifests, lockfiles, tsconfig, vite, index.html, .gitignore | 10 |
| Public docs | ARCHITECTURE, DATABASE, DESIGN_BRIEF_SCHEMA, PRIVACY_AND_DATA, RELEASE_NOTES, USER_GUIDE | 6 |
| Acceptance docs | browser UI / SVG / release checklist (no machine paths) | 3 |
| Portfolio docs | CASE-STUDY + screenshots from public case repo | 3 |
| New public meta | LICENSE, README, PUBLIC_SNAPSHOT_MANIFEST, CI workflow | 4 |

## Excluded categories

| Category | Reason |
|---|---|
| `docs/project-management/**` | internal planning, collaboration notes, machine paths, VM environment |
| `docs/project-management/deepseek/**` | internal submission material |
| `.cargo/` | local registry mirror config |
| `.agents/`, `.claude/` | machine-local agent config |
| `node_modules/`, `dist/`, `src-tauri/target/`, Sidecar binaries | build artifacts |
| `.env*`, SQLite, WAL/SHM, backups, attachments, logs | runtime data |
| Installers, ZIPs, historical binaries | not validated against this source; assets=0 |
| Absolute machine paths (`E:\`, `C:\Users\...`) | privacy |
| User SQLite, meetings, traces, credentials | privacy and safety |
| Internal freeze/plan commits (`mimo/*`, `3b4cea2` ancestry) | contain internal paths; not public history |

## Metadata policy

- `package.json` / `sidecar/package.json`: `private: true`, `license: MIT`, version `0.2.0`
- `Cargo.toml` / `tauri.conf.json`: version `0.2.0`, license `MIT`
- README states: source preview, no supported installer, no Windows release claim

## Test fake credentials

| Location | Value | Classification |
|---|---|---|
| `sidecar/test/server.test.mjs` | `transient-secret`, `anthropic-transient-secret`, `compat-secret` | test fake, reserved `.test` domains |
| `sidecar/test/process.test.mjs` | `provider-process-secret`, session token constant | test fake, loopback only |

These remain in tests on purpose; security tests must keep asserting non-leakage.

## Rollback

Public candidate is local-only. To discard:

```powershell
git checkout main
git branch -D public/v0.2.0-source-preview
```

Internal freeze remains at development repo `mimo/apm-v0.2.0-source-prep@592228c` / `41c4ae7`.
