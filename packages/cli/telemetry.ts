import { enableOpenTelemetry } from "@hooksmith/opentelemetry";
import {
  type Attributes,
  type Span,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";

enableOpenTelemetry();

const scope = "@hooksmith/cli";

export async function withCliSpan<T>(
  name: string,
  attributes: Attributes,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = trace.getTracer(scope);

  return await tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await run(span);
    } catch (error) {
      const exception = toException(error);
      span.recordException(exception);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: exception.message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function setCliSpanStatus(span: Span, success: boolean): void {
  span.setAttribute("hooksmith.status", success ? "success" : "failure");
  if (!success) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
}

function toException(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(String(error), { cause: error });
}
