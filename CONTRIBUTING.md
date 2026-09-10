# Contributing to ProjectScone Webapp

The [framework contribution guide](https://github.com/ProjectScone/ProjectScone/blob/main/CONTRIBUTING.md)
contains shared project expectations. This repository owns the React application,
its build, browser tests and streaming proxy. It consumes the framework API;
no sibling source tree or Python/Rust build is required for frontend builds.

## Setup and checks

Use Node 24 and pnpm 9.9.0:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm check:assets
```

Use strict TypeScript and meaningful typed interfaces. Keep API errors visible,
credentials out of generated assets, and accessibility and responsive layouts
part of UI review. Test streaming cancellation and WebSocket shutdown when
changing the proxy. Browser integration setup is documented in [README](README.md);
set SCONE_TEST_PYTHON to an independently installed framework interpreter.

## Pull requests

Create a feature/fix branch, keep changes focused, and explain behavior and
validation. Include screenshots for material UI changes and reproduce browser
regressions in the affected engine. Preserve commits when merging. Do not commit
node_modules, dist, secrets, operator environments, screenshots with private
content, or captured user conversations. Use synthetic test fixtures.

## Attribution

Contributions use [LICENSE](LICENSE). Preserve third-party notices and record
reused code provenance. [CITING.md](CITING.md) includes citation formats;
[CITATION.cff](CITATION.cff) credits Mark Sturman, JudgeHuman and ProjectScone.
