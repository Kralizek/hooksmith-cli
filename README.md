# Hooksmith CLI

[![CI](https://github.com/Kralizek/hooksmith-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Kralizek/hooksmith-cli/actions/workflows/ci.yml)

Command-line and GitHub Action distribution for [Hooksmith](https://github.com/Kralizek/hooksmith).

This repository owns the executable surfaces around Hooksmith: the `@hooksmith/cli` package and the GitHub Action that invokes it. The Hooksmith runtime, core contracts, pipeline helpers, and built-in extensions remain in the main Hooksmith repository and are consumed here as published JSR dependencies.

## Repository layout

```text
packages/
  cli/            @hooksmith/cli package
tests/
  fixtures/       CLI and GitHub Action integration fixtures
.github/
  workflows/
    ci.yml        Package, CLI, stream, and Action validation
    release.yml   CLI package and Action releases
action.yml        Hooksmith GitHub Action
deno.json         Workspace and dependency configuration
```

The repository remains workspace-based intentionally so additional executable or distribution packages can be added under `packages/` without restructuring the project.

## CLI

The CLI processes bounded event documents or streams NDJSON events through a Hooksmith runtime configuration.

```text
hooksmith help [command]
hooksmith --version
hooksmith -v
hooksmith run <event-file|glob|-> [event-file|glob...] [options]
hooksmith stream [options]
```

### Bounded runs

```sh
hooksmith run event.yaml
hooksmith run first.yaml second.json -c hooksmith.config.ts
hooksmith run "events/**/*.json" --format json
hooksmith run event.yaml --log debug
cat events.yaml | hooksmith run - --plan
```

`run` accepts YAML or JSON files, glob expressions, and `-` for bounded stdin. Inputs can contain one event, an array of events, or multiple YAML documents. Events are processed sequentially through one runtime instance.

Important options:

```text
-c, --config <path>          Config file (default: hooksmith.config.ts)
    --format table|json|tsv  Report format (default: table)
    --log <level>            trace|debug|info|warn|error|none (default: info)
    --plan                   Plan without invoking listeners
    --allow-empty            Allow a run resolving to zero events
```

See [`packages/cli`](packages/cli) for the full command contract and report semantics.

### Streaming

```sh
producer | hooksmith stream -c hooksmith.config.ts
producer | hooksmith stream --log warn
```

`stream` reads NDJSON from stdin and writes one compact NDJSON report for each non-empty input line. Event-level failures are reported without terminating the stream; process-level failures remain fatal.

Both `run` and `stream` write Hooksmith operational logs to stderr. `--log` controls the minimum emitted level; `none` suppresses operational logs entirely without suppressing CLI usage or parsing errors.

## GitHub Action

Hooksmith can be used directly from a workflow without installing Deno explicitly:

```yaml
- id: hooksmith
  uses: Kralizek/hooksmith-cli@v0
  with:
    event: .hooksmith/event.yaml
    config: hooksmith.config.ts
```

Inputs:

- `event` — path to the YAML or JSON event document.
- `config` — Hooksmith configuration module; defaults to `hooksmith.config.ts`.
- `plan` — evaluate routing without invoking listeners; defaults to `false`.
- `report-path` — optional location for the complete JSON report.
- `show-report` — print the captured JSON report after a successful run; defaults to `true`. Set it to `false` when only the file output is needed.
- `minimum-dependency-age` — minimum dependency age passed directly to Deno; defaults to `0`, allowing freshly published packages. Use Deno's native syntax, for example `P1D` for one day or `PT6H` for six hours. See [Deno's minimum dependency age documentation](https://docs.deno.com/runtime/reference/deno_json/#minimumdependencyage).

Outputs:

- `success` — whether the Hooksmith run succeeded.
- `mode` — `run` or `plan`.
- `report-path` — absolute path to the generated JSON report.

The Action streams Hooksmith logs to stderr while capturing the CLI's JSON stdout into the report file. On successful runs it prints that captured report to the workflow log by default. The file remains the canonical report output regardless of whether `show-report` is enabled, so downstream steps can consume `${{ steps.<id>.outputs.report-path }}` without parsing console output.

The Action uses the CLI version associated with the Action release, keeping the executable and Action distribution aligned. By default it disables Deno's minimum dependency age check so workflows can use newly published Hooksmith packages immediately; consumers can opt back into the check with `minimum-dependency-age`.

## Dependencies

The CLI consumes published Hooksmith packages rather than source files from the runtime repository. This keeps the repository boundary explicit and lets the CLI evolve and release independently.

Deno's default minimum dependency age remains enabled for third-party dependencies during development in this repository. Fresh `@hooksmith/core` and `@hooksmith/runtime` releases are explicitly exempted so this repository can validate a newly published Hooksmith runtime immediately.

## Development

Hooksmith CLI tracks the latest stable Deno 2.x release in CI.

```sh
deno task check
deno task cli -- help
```

The CI pipeline validates four layers independently:

1. formatting, linting, unit tests, and JSR publishability;
2. bounded multi-event CLI execution and failure behavior;
3. NDJSON streaming behavior;
4. the GitHub Action on both Linux and Windows, including run, plan, and failure outputs.

The integration scenarios use repository-owned fixtures under [`tests/fixtures`](tests/fixtures).

## Packages

- [`@hooksmith/cli`](packages/cli) — bounded runs, streaming, config loading, and report formatting.

## License

MIT
