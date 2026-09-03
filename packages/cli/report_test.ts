import { assertEquals, assertStringIncludes } from "@std/assert";
import { type CliReport, formatReport } from "./report.ts";

Deno.test("formats fallback events as flattened tsv rows", () => {
  const report: CliReport = {
    mode: "run",
    events: [{
      input: { source: "events.yaml", index: 1, sourceIndex: 1 },
      event: {
        type: "page.published",
        timestamp: "2026-08-31T20:00:00Z",
        source: { kind: "website", id: "example.com" },
      },
      outcome: "fallback",
      results: [{
        route: "fallback",
        listener: "log-unhandled",
        status: "success",
        message: "Unhandled event recorded",
      }],
      success: true,
    }],
    success: true,
  };

  assertEquals(
    formatReport(report, "tsv"),
    "event\tinput\tsource_index\tevent_type\toutcome\troute\tlistener\tstatus\tmessage\n1\tevents.yaml\t1\tpage.published\tfallback\tfallback\tlog-unhandled\tsuccess\tUnhandled event recorded",
  );
});

Deno.test("formats unmatched events even without listener results", () => {
  const report: CliReport = {
    mode: "run",
    events: [{
      input: { source: "events.yaml", index: 1, sourceIndex: 1 },
      event: {
        type: "page.deleted",
        timestamp: "2026-08-31T20:00:00Z",
        source: { kind: "website", id: "example.com" },
      },
      outcome: "unmatched",
      results: [],
      success: true,
    }],
    success: true,
  };

  assertStringIncludes(formatReport(report, "table"), "unmatched");
});

Deno.test("formats rejected inputs as synthetic rows", () => {
  const report: CliReport = {
    mode: "run",
    events: [{
      input: { source: "broken.json", index: 1, sourceIndex: 1 },
      outcome: "rejected",
      results: [],
      success: false,
      error: { stage: "input", message: "Invalid JSON" },
    }],
    success: false,
  };

  const tsv = formatReport(report, "tsv");
  assertStringIncludes(tsv, "broken.json");
  assertStringIncludes(tsv, "rejected");
  assertStringIncludes(tsv, "Invalid JSON");
});

Deno.test("json format preserves the aggregate events envelope", () => {
  const report: CliReport = {
    mode: "run",
    events: [],
    success: true,
  };

  assertEquals(JSON.parse(formatReport(report, "json")), report);
});
