import { Command } from "@cliffy/command";
import type { Config, Event, Logger } from "@hooksmith/core";
import { createRuntime } from "@hooksmith/runtime";
import { expandGlob } from "./glob.ts";
import { readEvents } from "./input.ts";
import { parseArgs } from "./args.ts";
import { formatRunReport, type RunReport } from "./report.ts";

export async function main(args: string[]): Promise<number> {
  const parsed = await parseArgs(args);

  if (parsed.kind === "help") {
    await writeStdout(parsed.text);
    return 0;
  }

  if (parsed.kind === "version") {
    await writeStdout(`${parsed.version}\n`);
    return 0;
  }

  if (parsed.kind === "stream") {
    return await runStream(parsed);
  }

  return await runBounded(parsed);
}

async function runBounded(
  parsed: Extract<Awaited<ReturnType<typeof parseArgs>>, { kind: "run" }>,
): Promise<number> {
  const mode = parsed.plan ? "plan" : "run";

  let config: Config;
  try {
    config = await loadConfig(parsed.config);
  } catch (error) {
    console.error(errorMessage(error));
    return 1;
  }

  const runtime = createRuntime(config, { log: stderrLogger });
  const reports: RunReport["events"] = [];
  let success = true;
  let inputIndex = 0;

  for (const pattern of parsed.events) {
    const paths = pattern === "-" ? ["-"] : await expandGlob(pattern);

    if (paths.length === 0) {
      if (parsed.allowEmpty) continue;

      success = false;
      reports.push({
        input: { index: ++inputIndex, path: pattern },
        success: false,
        outcome: "rejected",
        error: `No input matched ${pattern}`,
      });
      continue;
    }

    for (const path of paths) {
      try {
        const events = await readEvents(path);

        if (events.length === 0 && !parsed.allowEmpty) {
          success = false;
          reports.push({
            input: { index: ++inputIndex, path },
            success: false,
            outcome: "rejected",
            error: `No events found in ${path}`,
          });
          continue;
        }

        for (const event of events) {
          const index = ++inputIndex;
          try {
            const result = parsed.plan
              ? await runtime.plan(event)
              : await runtime.run(event);

            const eventSuccess = result.success;
            success &&= eventSuccess;
            reports.push({
              input: { index, path },
              event,
              success: eventSuccess,
              outcome: eventSuccess ? "processed" : "failed",
              results: result.results,
            });
          } catch (error) {
            success = false;
            reports.push({
              input: { index, path },
              event,
              success: false,
              outcome: "failed",
              error: errorMessage(error),
            });
          }
        }
      } catch (error) {
        success = false;
        reports.push({
          input: { index: ++inputIndex, path },
          success: false,
          outcome: "rejected",
          error: errorMessage(error),
        });
      }
    }
  }

  const report: RunReport = {
    success,
    mode,
    events: reports,
  };

  await writeStdout(formatRunReport(report, parsed.format));
  return success ? 0 : 1;
}

async function runStream(
  parsed: Extract<Awaited<ReturnType<typeof parseArgs>>, { kind: "stream" }>,
): Promise<number> {
  let config: Config;
  try {
    config = await loadConfig(parsed.config);
  } catch (error) {
    console.error(errorMessage(error));
    return 1;
  }

  const runtime = createRuntime(config, { log: stderrLogger });

  for await (const line of readLines(Deno.stdin.readable)) {
    if (line.trim().length === 0) continue;

    let report: RunReport;
    try {
      const document = JSON.parse(line);
      const events = await readEventsFromValue(document);

      if (events.length !== 1) {
        throw new Error("Each NDJSON line must contain exactly one event.");
      }

      const event = events[0];
      try {
        const result = parsed.plan
          ? await runtime.plan(event)
          : await runtime.run(event);
        report = {
          success: result.success,
          mode: parsed.plan ? "plan" : "run",
          events: [{
            input: { index: 1, path: "stdin" },
            event,
            success: result.success,
            outcome: result.success ? "processed" : "failed",
            results: result.results,
          }],
        };
      } catch (error) {
        report = {
          success: false,
          mode: parsed.plan ? "plan" : "run",
          events: [{
            input: { index: 1, path: "stdin" },
            event,
            success: false,
            outcome: "failed",
            error: errorMessage(error),
          }],
        };
      }
    } catch (error) {
      report = {
        success: false,
        mode: parsed.plan ? "plan" : "run",
        events: [{
          input: { index: 1, path: "stdin" },
          success: false,
          outcome: "rejected",
          error: errorMessage(error),
        }],
      };
    }

    await writeStdout(`${JSON.stringify(report)}\n`);
  }

  return 0;
}

async function loadConfig(path: string): Promise<Config> {
  const module = await import(toFileUrl(path).href);
  const config = module.default;
  if (!config || !Array.isArray(config.routes)) {
    throw new Error(`Config ${path} must default-export a Hooksmith Config.`);
  }
  return config as Config;
}

function toFileUrl(path: string): URL {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path)) return new URL(path);
  return new URL(`file://${Deno.cwd().replaceAll("\\", "/")}/${path.replaceAll("\\", "/")}`);
}

async function readEventsFromValue(value: unknown): Promise<Event[]> {
  const text = JSON.stringify(value);
  const temp = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(temp, text);
    return await readEvents(temp);
  } finally {
    await Deno.remove(temp).catch(() => undefined);
  }
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        yield buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    if (buffer.length > 0) yield buffer.replace(/\r$/, "");
  } finally {
    reader.releaseLock();
  }
}

const stderrLogger: Logger = {
  debug: (message, ...args) => logToStderr("DEBUG", message, args),
  info: (message, ...args) => logToStderr("INFO", message, args),
  warn: (message, ...args) => logToStderr("WARN", message, args),
  error: (message, ...args) => logToStderr("ERROR", message, args),
};

function logToStderr(level: string, message: string, args: unknown[]): void {
  const suffix = args.length === 0
    ? ""
    : ` ${args.map(renderLogValue).join(" ")}`;
  console.error(`[${level}] ${message}${suffix}`);
}

function renderLogValue(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeStdout(value: string): Promise<void> {
  await Deno.stdout.write(new TextEncoder().encode(value));
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
