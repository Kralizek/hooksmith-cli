import { assertEquals, assertRejects } from "@std/assert";
import { loadConfig } from "./mod.ts";

Deno.test("loads a default-exported config module", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/hooksmith.config.ts`;
  try {
    await Deno.writeTextFile(path, "export default { routes: [] };\n");
    const config = await loadConfig(path);
    assertEquals(config.routes, []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("rejects config modules without a default export", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/hooksmith.config.ts`;
  try {
    await Deno.writeTextFile(path, "export const config = { routes: [] };\n");
    await assertRejects(() => loadConfig(path), Error, "default export");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
