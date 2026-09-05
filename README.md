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

### OpenTelemetry

The CLI is an OpenTelemetry-aware Hooksmith host. It installs the Hooksmith OpenTelemetry backend when command execution begins and creates a top-level span for each executable operation:

```text
hooksmith.cli.run
└─ hooksmith.event.process
   └─ hooksmith.listener

hooksmith.cli.stream
└─ hooksmith.event.process
   └─ hooksmith.listener
```

The CLI uses the standard OpenTelemetry API. It does not configure an OpenTelemetry SDK, provider, exporter, or collector. With Deno's built-in OpenTelemetry support, enable export through environment variables:

```sh
OTEL_DENO=true \
OTEL_EXPORTER_OTLP_PROTOCOL=console \
OTEL_SERVICE_NAME=hooksmith-cli \
hooksmith run event.yaml
```

Use the normal `OTEL_*` environment variables for OTLP endpoints, headers, sampling, resource attributes, and exporter configuration. The same environment-based configuration works when the CLI is invoked through the GitHub Action.

The CLI spans use the `@hooksmith/cli` instrumentation scope. `hooksmith.cli.run` records `hooksmith.mode=run|plan`; `hooksmith.cli.stream` records `hooksmith.mode=run`. Both record `hooksmith.status`, and process-level exceptions are recorded on the CLI span. Runtime, pipeline, extension, and Deno-native spans then attach below the active CLI span.

## GitHub Action

Hooksmith can be used directly from a workflow without installing Deno explicitly:

```yaml
- id: hooksmith
  uses: Kralizek/hooksmith-cli@v0
  with:
    event: .hooksmith/event.yaml
    config: hooksmith.config.ts
    log: info
```

Inputs:

- `event` — path to the YAML or JSON event document.
- `config` — Hooksmith configuration module; defaults to `hooksmith.config.ts`.
- `plan` — evaluate routing without invoking listeners; defaults to `false`.
- `log` — minimum Hooksmith log level: `trace`, `debug`, `info`, `warn`, `error`, or `none`; defaults to `info`.
- `report-path` — optional location for the complete JSON report.
- `show-report` — print the captured JSON report after a successful run; defaults to `true`. Set it to `false` when only the file output is needed.
- `minimum-dependency-age` — minimum dependency age passed directly to Deno; defaults to `0`, allowing freshly published packages. Use Deno's native syntax, for example `P1D` for one day or `PT6H` for six hours. See [Deno's minimum dependency age documentation](https://docs.deno.com/runtime/reference/deno_json/#minimumdependencyage).

Outputs:

- `success` — whether the Hooksmith run succeeded.
- `mode` — `run` or `plan`.
- `report-path` — absolute path to the generated JSON report.

The Action streams Hooksmith logs to stderr while capturing the CLI's JSON stdout into the report file. The `log` input is passed directly to the CLI's `--log` option. On successful runs the Action prints the captured report to the workflow log by default. The file remains the canonical report output regardless of whether `show-report` is enabled, so downstream steps can consume `${{ steps.<id>.outputs.report-path }}` without parsing console output.

OpenTelemetry is available through the CLI but is not enabled by the Action. Workflows that want telemetry can opt in with Deno's standard environment configuration, for example:

```yaml
- id: hooksmith
  uses: Kralizek/hooksmith-cli@v0
  with:
    event: .hooksmith/event.yaml
    config: hooksmith.config.ts
  env:
    OTEL_DENO: "true"
    OTEL_SERVICE_NAME: deployment-notification
    OTEL_EXPORTER_OTLP_ENDPOINT: ${{ secrets.OTEL_EXPORTER_OTLP_ENDPOINT }}
```

The Action does not introduce Hooksmith-specific OpenTelemetry inputs; provider, exporter, endpoint, sampling, resource, and service configuration remain standard `OTEL_*` environment variables owned by the consuming workflow.

The Action uses the CLI version associated with the Action release, keeping the executable and Action distribution aligned. By default it disables Deno's minimum dependency age check so workflows can use newly published Hooksmith packages immediately; consumers can opt back into the check with `minimum-dependency-age`.

## Dependencies

The CLI consumes published Hooksmith packages rather than source files from the runtime repository. This keeps the repository boundary explicit and lets the CLI evolve and release independently.

Deno's default minimum dependency age remains enabled for third-party dependencies during development in this repository. Fresh `@hooksmith/core`, `@hooksmith/opentelemetry`, and `@hooksmith/runtime` releases are explicitly exempted so this repository can validate a newly published Hooksmith runtime immediately.

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

- [`@hooksmith/cli`](packages/cli) — bounded runs, streaming, config loading, report formatting, and OpenTelemetry host instrumentation.

## License

MIT
