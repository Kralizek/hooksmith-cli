import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { expandInputExpression } from "./glob.ts";

Deno.test("expands glob files in deterministic path order", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(root, "b.json"), "[]");
    await Deno.writeTextFile(join(root, "a.json"), "[]");
    await Deno.mkdir(join(root, "directory.json"));

    const matches = await expandInputExpression(join(root, "*.json"));
    assertEquals(matches.map((path) => path.slice(root.length + 1)), ["a.json", "b.json"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("zero-match globs expand to an empty input list", async () => {
  const root = await Deno.makeTempDir();
  try {
    assertEquals(await expandInputExpression(join(root, "*.json")), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
