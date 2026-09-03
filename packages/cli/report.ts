import type { ResourceReference } from "@hooksmith/core";
import type {
  EventReport,
  ListenerReport,
  RoutingOutcome,
  RunReport as RuntimeRunReport,
} from "@hooksmith/runtime";
import type { ReportFormat } from "./args.ts";

/** Locates an event within the CLI input sources. */
export interface EventInput {
  source: string;
  index: number;
  sourceIndex: number;
}

/** Error captured while loading or processing one CLI event. */
export interface EventError {
  stage: "input" | "runtime";
  message: string;
}

/** Routing or failure outcome reported for one CLI event. */
export type EventOutcome = RoutingOutcome | "rejected" | "failed";

/** Complete execution report for one input event. */
export interface EventExecutionReport {
  input: EventInput;
  event?: EventReport;
  outcome: EventOutcome;
  results: ListenerReport[];
  success: boolean;
  error?: EventError;
}

/** Aggregate CLI report for a bounded run or plan. */
export interface CliReport {
  mode: "run" | "plan";
  events: EventExecutionReport[];
  success: boolean;
}

export function createReport(
  mode: "run" | "plan",
  events: EventExecutionReport[],
): CliReport {
  return {
    mode,
    events,
    success: events.every((event) => event.success),
  };
}

export function formatReport(
  report: CliReport | RuntimeRunReport,
  format: ReportFormat,
): string {
  const normalized = "events" in report ? report : fromRuntimeReport(report);

  switch (format) {
    case "json":
      return JSON.stringify(normalized, undefined, 2);
    case "tsv":
      return formatTsv(normalized);
    case "table":
      return formatTable(normalized);
  }
}

function formatTable(report: CliReport): string {
  const output = [
    `Mode: ${report.mode}`,
    `Success: ${report.success}`,
  ];

  for (const event of report.events) {
    output.push(
      "",
      `Event #${event.input.index}: ${event.event?.type ?? "invalid"}`,
      `Input: ${event.input.source} #${event.input.sourceIndex}`,
      `Outcome: ${event.outcome}`,
      `Success: ${event.success}`,
      "",
    );

    const rows = resultRows(event);
    const headers = ["Route", "Listener", "Status", "Outcome", "Message"];
    const widths = headers.map((header, index) =>
      Math.max(header.length, ...rows.map((row) => row[index].length))
    );
    const line = (row: string[]) =>
      row.map((cell, index) => cell.padEnd(widths[index])).join("  ")
        .trimEnd();

    output.push(
      line(headers),
      line(widths.map((width) => "-".repeat(width))),
      ...rows.map(line),
    );
  }

  return output.join("\n");
}

function formatTsv(report: CliReport): string {
  const header = [
    "event",
    "input",
    "source_index",
    "event_type",
    "outcome",
    "route",
    "listener",
    "status",
    "message",
  ].join("\t");
  const rows: string[] = [];

  for (const event of report.events) {
    for (const row of resultRows(event)) {
      rows.push(
        [
          String(event.input.index),
          event.input.source,
          String(event.input.sourceIndex),
          event.event?.type ?? "",
          row[3],
          row[0],
          row[1],
          row[2],
          row[4],
        ].map(tsvCell).join("\t"),
      );
    }
  }

  return [header, ...rows].join("\n");
}

function resultRows(event: EventExecutionReport): string[][] {
  if (event.results.length === 0) {
    return [[
      event.outcome === "unmatched"
        ? "unmatched"
        : event.outcome === "fallback"
        ? "fallback"
        : "",
      "",
      event.success ? "success" : "failure",
      event.outcome,
      event.error?.message ?? "",
    ]];
  }

  return event.results.map((result) => [
    result.route,
    result.listener,
    result.status,
    listenerOutcome(event, result),
    result.message ?? "",
  ]);
}

function listenerOutcome(
  event: EventExecutionReport,
  result: ListenerReport,
): string {
  if (result.status === "planned") {
    return "planned";
  }
  if (event.outcome === "fallback") {
    return "fallback";
  }
  if (isRecord(result.data)) {
    const pipeline = result.data.pipeline;
    if (isRecord(pipeline) && typeof pipeline.outcome === "string") {
      return pipeline.outcome;
    }
    if (result.data.stage === "transform") {
      return "transform-failed";
    }
  }
  return "executed";
}

function fromRuntimeReport(report: RuntimeRunReport): CliReport {
  const event: EventExecutionReport = {
    input: { source: "event", index: 1, sourceIndex: 1 },
    event: report.event,
    outcome: report.outcome ?? inferRoutingOutcome(report),
    results: report.results,
    success: report.success,
  };
  return createReport(report.mode, [event]);
}

export function inferRoutingOutcome(report: RuntimeRunReport): RoutingOutcome {
  if (report.results.some((result) => result.route === "fallback")) {
    return "fallback";
  }
  return report.results.length === 0 ? "unmatched" : "matched";
}

export function toEventReport(event: {
  type: string;
  timestamp: { toString(): string };
  source: ResourceReference;
  subject?: ResourceReference;
  metadata?: Record<string, unknown>;
}): EventReport {
  return {
    type: event.type,
    timestamp: event.timestamp.toString(),
    source: event.source,
    subject: event.subject,
    metadata: event.metadata,
  };
}

function tsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
