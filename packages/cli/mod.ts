#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net

import type { Config, Event } from "@hooksmith/core";
import {
  assertEventDocument,
  createLoggerFactory,
  createRuntime,
  hydrateEvent,
  type Runtime,
} from "@hooksmith/runtime";
import { Command, EnumType } from "@cliffy/command";
import { resolve, toFileUrl } from "@std/path";
import cliMetadata from "./deno.json" with { type: "json" };
import type { RunCliOptions } from "./args.ts";
import { loadEventDocuments, resolveInputPaths } from "./input.ts";
import {
  type CliReport,
  createReport,
  type EventExecutionReport,
  type EventInput,
  formatReport,
  inferRoutingOutcome,
  toEventReport,
} from "./report.ts";

export * from "./args.ts";
export * from "./input.ts";
export * from "./report.ts";

export const VERSION = cliMetadata.version;

let exitCode = 0;
const reportFormatType = new EnumType(["table", "json", "tsv"] as const);

const loggerFactory = createLoggerFactory({
  minimumLevel: "debug",
  write(record) {
    const values: unknown[] = [
      `[${record.level.toUpperCase()}] ${record.message}`,
    ];
    if (record.properties !== undefined) values.push(record.properties);
    if (record.error !== undefined) values.push(record.error);
    console.error(...values);
  },
});
const stderrLogger = loggerFactory.getLogger("CLI");

const runCommand = new Command()
  .description("Process one or more bounded event inputs.")
  .helpOption(false)
  .type("report-format", reportFormatType)
  .arguments("<eventFile:string> [...eventFiles:string]")
  .option(
    "-c, --config <path:string>",
    "Config file.",
    { default: "hooksmith.config.ts" },
  )
  .option(
    "--format <format:report-format>",
    "Report format.",
    { default: "table" },
  )
  .option("--plan", "Plan events without invoking listeners.")
  .option("--allow-empty", "Allow a run that resolves to zero events.")
  .action(async (options, eventFile, ...eventFiles) => {
    const inputs = [eventFile, ...eventFiles];
    if (inputs.filter((path) => path === "-").length > 1) {
      throw new Error("run accepts stdin at most once.");
    }

    const configFile = resolve(options.config);
    const config = await loadConfig(configFile);
    const runtime = createRuntime(config, { logger: loggerFactory });
    const report = await processBounded(runtime, {
      eventFiles: inputs,
      configFile,
      format: options.format,
      plan: options.plan ?? false,
      allowEmpty: options.allowEmpty ?? false,
    });

    await writeStdout(`${formatReport(report, options.format)}\n`);
    exitCode = report.success ? 0 : 1;
  });

const streamCommand = new Command()
  .description("Read NDJSON events from stdin and emit NDJSON reports.")
  .helpOption(false)
  .option(
    "-c, --config <path:string>",
    "Config file.",
    { default: "hooksmith.config.ts" },
  )
  .action(async (options) => {
    const config = await loadConfig(resolve(options.config));
    const runtime = createRuntime(config, { logger: loggerFactory });
    exitCode = await processStream(runtime);
  });

const helpCommand = new Command()
  .description("Show this help or the help of a sub-command.")
  .helpOption(false)
  .noGlobals()
  .option("-h, --help", "", {
    hidden: true,
    action: () => {
      throw new Error("Unknown option: --help.");
    },
  })
  .arguments("[command:string]")
  .action(function (_, commandName?: string) {
    const parent = this.getGlobalParent();
    const command = commandName ? parent?.getBaseCommand(commandName) : parent;

    if (!command) {
      throw new Error(`Unknown command: ${commandName}.`);
    }

    command.showHelp();
  });

const cli = new Command()
  .name("hooksmith")
  .description("Process events with Hooksmith.")
  .version(VERSION)
  .helpOption(false)
  .versionOption("-v, --version", "Print the Hooksmith CLI version.")
  .noExit()
  .command("run", runCommand)
  .command("stream", streamCommand)
  .command("help", helpCommand)
  .action(function () {
    this.showHelp();
  });

export function usage(): string {
  return cli.getHelp();
}

export async function main(args: string[]): Promise<number> {
  exitCode = args.length === 0 ? 1 : 0;

  try {
    await cli.parse(args);
    return exitCode;
  } catch (error) {
    stderrLogger.error(errorMessage(error));
    return 1;
  }
}

async function processBounded(
  runtime: Runtime,
  options: RunCliOptions,
): Promise<CliReport> {
  const events: EventExecutionReport[] = [];
  let eventIndex = 0;
  const paths = await resolveInputPaths(options.eventFiles);

  for (const path of paths) {
    const source = inputSource(path);
    let documents: unknown[];

    try {
      documents = await loadEventDocuments(path);
    } catch (error) {
      eventIndex++;
      events.push(inputFailure(
        { source, index: eventIndex, sourceIndex: 1 },
        error,
      ));
      continue;
    }

    for (let sourceIndex = 0; sourceIndex < documents.length; sourceIndex++) {
      eventIndex++;
      events.push(
        await processDocument(
          runtime,
          documents[sourceIndex],
          { source, index: eventIndex, sourceIndex: sourceIndex + 1 },
          options.plan,
        ),
      );
    }
  }

  if (events.length === 0 && !options.allowEmpty) {
    events.push(inputFailure(
      { source: "run", index: 1, sourceIndex: 0 },
      new Error("No events were resolved from the supplied inputs."),
    ));
  }

  return createReport(options.plan ? "plan" : "run", events);
}

async function processStream(runtime: Runtime): Promise<number> {
  let eventIndex = 0;
  let lineNumber = 0;

  for await (const line of readLines(Deno.stdin.readable)) {
    lineNumber++;
    if (line.trim().length === 0) continue;

    eventIndex++;
    const input: EventInput = {
      source: "stdin",
      index: eventIndex,
      sourceIndex: lineNumber,
    };

    let eventReport: EventExecutionReport;
    try {
      eventReport = await processDocument(
        runtime,
        JSON.parse(line),
        input,
        false,
      );
    } catch (error) {
      eventReport = inputFailure(input, error);
    }

    const report = createReport("run", [eventReport]);
    await writeStdout(`${JSON.stringify(report)}\n`);
  }

  return 0;
}

async function processDocument(
  runtime: Runtime,
  document: unknown,
  input: EventInput,
  plan: boolean,
): Promise<EventExecutionReport> {
  let event: Event;

  try {
    assertEventDocument(document);
    event = hydrateEvent(document);
  } catch (error) {
    return inputFailure(input, error);
  }

  try {
    const report = plan
      ? await runtime.plan(event)
      : await runtime.process(event);

    return {
      input,
      event: report.event,
      outcome: report.outcome ?? inferRoutingOutcome(report),
      results: report.results,
      success: report.success,
    };
  } catch (error) {
    return {
      input,
      event: toEventReport(event),
      outcome: "failed",
      results: [],
      success: false,
      error: { stage: "runtime", message: errorMessage(error) },
    };
  }
}

function inputFailure(input: EventInput, error: unknown): EventExecutionReport {
  return {
    input,
    outcome: "rejected",
    results: [],
    success: false,
    error: { stage: "input", message: errorMessage(error) },
  };
}

export async function loadConfig(path: string): Promise<Config> {
  const module = await import(toFileUrl(path).href);
  if (!("default" in module)) {
    throw new Error("Config module must have a default export.");
  }

  return module.default as Config;
}

function inputSource(path: string): string {
  return path === "-" ? "stdin" : path;
}

async function* readLines(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        yield line;
      }
    }

    if (buffer.length > 0) yield buffer.replace(/\r$/, "");
  } finally {
    reader.releaseLock();
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
