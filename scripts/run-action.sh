#!/usr/bin/env bash
set -euo pipefail

deno_args=(--quiet --minimum-dependency-age "$HOOKSMITH_MINIMUM_DEPENDENCY_AGE")
if [[ -n "${HOOKSMITH_CLI_ENTRYPOINT:-}" ]]; then
  cli="$HOOKSMITH_CLI_ENTRYPOINT"
else
  cli="$GITHUB_ACTION_PATH/packages/cli/mod.ts"
  deno_args+=(--config "$GITHUB_ACTION_PATH/deno.json")
fi

args=(
  run "$HOOKSMITH_EVENT"
  --config "$HOOKSMITH_CONFIG"
  --format json
  --log "$HOOKSMITH_LOG"
)

case "$HOOKSMITH_PLAN" in
  true)
    args+=(--plan)
    mode=plan
    ;;
  false)
    mode=run
    ;;
  *)
    echo "::error::plan must be either 'true' or 'false'."
    exit 1
    ;;
esac

case "$HOOKSMITH_LOG" in
  trace|debug|info|warn|error|none)
    ;;
  *)
    echo "::error::log must be one of: trace, debug, info, warn, error, none."
    exit 1
    ;;
esac

case "$HOOKSMITH_SHOW_REPORT" in
  true|false)
    ;;
  *)
    echo "::error::show-report must be either 'true' or 'false'."
    exit 1
    ;;
esac

if [[ -z "$HOOKSMITH_REPORT_PATH" ]]; then
  report_id="$(deno eval 'console.log(crypto.randomUUID())')"
  raw_report_path="$RUNNER_TEMP/hooksmith/report-${report_id}.json"
else
  raw_report_path="$HOOKSMITH_REPORT_PATH"
fi

report_path="$(
  deno eval \
    'import { isAbsolute, resolve } from "node:path"; const [path, workspace] = Deno.args; const resolved = isAbsolute(path) ? path : resolve(workspace, path); console.log(Deno.build.os === "windows" ? resolved.replaceAll("\\", "/") : resolved);' \
    "$raw_report_path" \
    "$GITHUB_WORKSPACE"
)"

capture_id="$(deno eval 'console.log(crypto.randomUUID())')"
capture_path="$RUNNER_TEMP/hooksmith/capture-${capture_id}.json"
mkdir -p "$(dirname "$report_path")" "$(dirname "$capture_path")"

success=false
output_report_path=""

set +e
deno run "${deno_args[@]}" -A "$cli" "${args[@]}" > "$capture_path"
status=$?
set -e

if [[ -s "$capture_path" ]]; then
  if values="$(
    deno eval --allow-read \
      'const report = JSON.parse(await Deno.readTextFile(Deno.args[0])); if (typeof report !== "object" || report === null || typeof report.success !== "boolean" || (report.mode !== "run" && report.mode !== "plan") || !Array.isArray(report.events)) Deno.exit(1); console.log(`${report.success}\t${report.mode}`);' \
      "$capture_path" 2>/dev/null
  )"; then
    IFS=$'\t' read -r success mode <<< "$values"
    mv "$capture_path" "$report_path"
    output_report_path="$report_path"
  fi
fi

rm -f "$capture_path"

echo "success=$success" >> "$GITHUB_OUTPUT"
echo "mode=$mode" >> "$GITHUB_OUTPUT"
echo "report-path=$output_report_path" >> "$GITHUB_OUTPUT"

if [[ "$HOOKSMITH_SHOW_REPORT" == "true" && -n "$output_report_path" ]]; then
  cat "$output_report_path"
fi

exit "$status"
