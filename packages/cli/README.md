# @hooksmith/cli

Command-line interface for loading Hooksmith event documents and configuration,
running or planning bounded event sets, streaming events from stdin, and
rendering reports.

## Usage

```text
hooksmith help [command]
hooksmith --version
hooksmith -v
hooksmith run <event-file|glob|-> [event-file|glob...] [options]
hooksmith stream [options]
```

Use `hooksmith help run` and `hooksmith help stream` for command-specific help.

### Bounded runs

```text
-c, --config <path>          Config file (default: hooksmith.config.ts)
    --format table|json|tsv  Report format (default: table)
    --log <level>            trace|debug|info|warn|error|none (default: info)
    --plan                   Plan events without invoking listeners
    --allow-empty            Allow a run resolving to zero events
```

`run` accepts one or more YAML/JSON files, glob patterns, plus `-` for bounded
stdin. Each source may contain a single event, an array of events, or multiple
YAML documents. Glob matches are processed in deterministic path order. Inputs
are flattened and processed sequentially in source order by a single runtime
instance.

The report shape is the same for one or many events: JSON reports contain an
`events` array, while table and TSV output retain the event input and index for
each result.

```sh
hooksmith run first.yaml second.json -c hooksmith.config.ts
hooksmith run "events/**/*.json" -c hooksmith.config.ts
hooksmith run event.json --log debug
cat events.yaml | hooksmith run - --format json
```

By default, a bounded run fails if all supplied inputs resolve to zero events.
`--allow-empty` changes only that final empty-set check; invalid matched files
or invalid event documents are still reported as failures.

### Streaming

```text
-c, --config <path>          Config file (default: hooksmith.config.ts)
    --log <level>            trace|debug|info|warn|error|none (default: info)
```

`stream` reads NDJSON from stdin and emits one compact NDJSON report for every
non-empty input line. It has no `--plan`, `--format`, or `--allow-empty` option:
streaming input and output are both part of the command contract.

```sh
producer | hooksmith stream -c hooksmith.config.ts
producer | hooksmith stream --log warn
```

Both commands write Hooksmith operational logs to stderr. `--log` controls the
minimum emitted level, and `none` suppresses operational logs entirely. CLI
usage and parsing errors are still written to stderr independently of that
setting.

Event-level failures are emitted as unsuccessful reports and processing
continues. Normal EOF exits successfully; process-level failures such as
configuration, stdin, or stdout failures remain fatal.
