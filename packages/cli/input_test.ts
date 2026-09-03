import { assertEquals, assertRejects } from "@std/assert";
import {
  loadEventDocument,
  loadEventDocuments,
  resolveInputPaths,
} from "./input.ts";

Deno.test("loads one event document from bounded stdin", async () => {
  const document = await loadEventDocument(
    "-",
    () =>
      Promise.resolve(
        '{"type":"page.published","source":{"kind":"website"},"data":{}}',
      ),
  ) as Record<string, unknown>;

  assertEquals(document.type, "page.published");
});

Deno.test("flattens JSON arrays into event documents", async () => {
  const documents = await loadEventDocuments(
    "events.json",
    () => Promise.resolve('[{"type":"one"},{"type":"two"}]'),
  ) as Record<string, unknown>[];

  assertEquals(documents.map((document) => document.type), ["one", "two"]);
});

Deno.test("flattens YAML documents and arrays in source order", async () => {
  const documents = await loadEventDocuments(
    "events.yaml",
    () => Promise.resolve("---\ntype: one\n---\n- type: two\n- type: three\n"),
  ) as Record<string, unknown>[];

  assertEquals(documents.map((document) => document.type), [
    "one",
    "two",
    "three",
  ]);
});

Deno.test("loads YAML timestamps as strings", async () => {
  const path = await Deno.makeTempFile({ suffix: ".yaml" });

  try {
    await Deno.writeTextFile(
      path,
      "type: page.published\ntimestamp: 2026-08-31T20:00:00Z\nsource:\n  kind: website\ndata: {}\n",
    );

    const document = await loadEventDocument(path) as Record<string, unknown>;
    assertEquals(document.timestamp, "2026-08-31T20:00:00Z");
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("rejects unsupported event file extensions", async () => {
  await assertRejects(
    () => loadEventDocuments("events.txt", () => Promise.resolve("{}")),
    Error,
    ".yaml, .yml, or .json",
  );
});

Deno.test("resolves explicit paths and zero-match globs in input order", async () => {
  const directory = await Deno.makeTempDir();
  const explicit = `${directory}/first.json`;
  const matched = `${directory}/second.json`;

  try {
    await Deno.writeTextFile(explicit, "{}");
    await Deno.writeTextFile(matched, "{}");

    const resolved = await resolveInputPaths([
      explicit,
      `${directory}/missing-*.json`,
      `${directory}/second*.json`,
    ]);

    assertEquals(resolved, [explicit, matched]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
