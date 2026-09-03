import { extname } from "@std/path";
import { parseAll as parseAllYaml } from "@std/yaml";
import { expandInputExpressions } from "./glob.ts";

export { expandInputExpression, expandInputExpressions } from "./glob.ts";

export async function resolveInputPaths(expressions: readonly string[]): Promise<string[]> {
  return await expandInputExpressions(expressions);
}

export async function loadEventDocuments(path: string, readContent: (path: string) => Promise<string> = readEventContent): Promise<unknown[]> {
  const content = await readContent(path);
  let documents: unknown[];

  if (path === "-") {
    documents = parseAllYaml(content, { schema: "core" });
  } else {
    switch (extname(path).toLowerCase()) {
      case ".yaml":
      case ".yml":
        documents = parseAllYaml(content, { schema: "core" });
        break;
      case ".json":
        documents = [JSON.parse(content)];
        break;
      default:
        throw new Error("Event file must use .yaml, .yml, or .json.");
    }
  }

  return documents.flatMap((document) => Array.isArray(document) ? document : [document]);
}

export async function loadEventDocument(path: string, readContent: (path: string) => Promise<string> = readEventContent): Promise<unknown> {
  const documents = await loadEventDocuments(path, readContent);
  return documents.length === 1 ? documents[0] : documents;
}

async function readEventContent(path: string): Promise<string> {
  if (path === "-") return await new Response(Deno.stdin.readable).text();
  return await Deno.readTextFile(path);
}
