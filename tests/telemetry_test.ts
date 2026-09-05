import { assert, assertEquals } from "@std/assert";
import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { Config, Event } from "@hooksmith/core";
import { createRuntime, nullLoggerFactory } from "@hooksmith/runtime";
import {
  setCliSpanStatus,
  withCliSpan,
} from "../packages/cli/telemetry.ts";

Deno.test("CLI OpenTelemetry span parents Hooksmith runtime spans", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();

  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager);

  try {
    const config: Config = {
      routes: [{
        name: "test-route",
        listeners: [{
          name: "test-listener",
          run() {
            return { success: true };
          },
        }],
      }],
    };
    const runtime = createRuntime(config, { logger: nullLoggerFactory });
    const event: Event = {
      type: "test.event",
      timestamp: Temporal.Instant.from("2026-09-05T19:00:00Z"),
      source: { kind: "test" },
      data: {},
    };

    await withCliSpan(
      "hooksmith.cli.run",
      {
        "hooksmith.cli.command": "run",
        "hooksmith.mode": "run",
      },
      async (span) => {
        const report = await runtime.process(event);
        setCliSpanStatus(span, report.success);
      },
    );

    const spans = exporter.getFinishedSpans();
    const singleSpan = (name: string) => {
      const matches = spans.filter((span) => span.name === name);
      assertEquals(matches.length, 1, `Expected one span named ${name}`);
      const [span] = matches;
      assert(span);
      return span;
    };

    const cliSpan = singleSpan("hooksmith.cli.run");
    const eventSpan = singleSpan("hooksmith.event.process");
    const listenerSpan = singleSpan("hooksmith.listener");

    assertEquals(cliSpan.instrumentationScope.name, "@hooksmith/cli");
    assertEquals(cliSpan.attributes["hooksmith.cli.command"], "run");
    assertEquals(cliSpan.attributes["hooksmith.mode"], "run");
    assertEquals(cliSpan.attributes["hooksmith.status"], "success");
    assertEquals(
      eventSpan.parentSpanContext?.spanId,
      cliSpan.spanContext().spanId,
    );
    assertEquals(
      listenerSpan.parentSpanContext?.spanId,
      eventSpan.spanContext().spanId,
    );
  } finally {
    await provider.shutdown();
    contextManager.disable();
    context.disable();
    trace.disable();
  }
});
