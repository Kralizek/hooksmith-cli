import { assertEquals, assertStringIncludes } from "@std/assert";
import { usage, VERSION } from "./mod.ts";

Deno.test("generated Cliffy help describes the command surface", () => {
  const help = usage();

  assertStringIncludes(help, "hooksmith");
  assertStringIncludes(help, VERSION);
  assertStringIncludes(help, "run");
  assertStringIncludes(help, "stream");
  assertStringIncludes(help, "help");
  assertStringIncludes(help, "--version");
  assertEquals(help.includes("--help"), false);
});

Deno.test("Cliffy exposes command-only help and option-only version", async () => {
  for (
    const args of [
      ["help"],
      ["help", "run"],
      ["help", "stream"],
    ]
  ) {
    const output = await runCli(args);
    assertEquals(output.code, 0, `Expected success for: ${args.join(" ")}`);
  }

  for (const args of [["--version"], ["-v"]]) {
    const output = await runCli(args);
    assertEquals(output.code, 0, `Expected success for: ${args.join(" ")}`);
    assertStringIncludes(output.stdout, VERSION);
  }
});

Deno.test("Cliffy rejects unsupported meta-command forms", async () => {
  for (
    const args of [
      [],
      ["--help"],
      ["-h"],
      ["run", "event.json", "--help"],
      ["stream", "--help"],
      ["help", "--help"],
      ["version"],
    ]
  ) {
    const output = await runCli(args);
    const invocation = args.length === 0 ? "<no args>" : args.join(" ");
    assertEquals(
      output.code === 0,
      false,
      `Expected failure for: ${invocation}`,
    );
  }
});

Deno.test("Cliffy reports parse errors without uncaught stack traces", async () => {
  const output = await runCli(["run", "event.json", "--does-not-exist"]);

  assertEquals(output.code, 1);
  assertStringIncludes(output.stderr, "ERROR");
  assertEquals(output.stderr.includes("Uncaught"), false);
});

async function runCli(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "packages/cli/mod.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
