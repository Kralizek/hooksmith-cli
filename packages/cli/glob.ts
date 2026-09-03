import { expandGlob } from "@std/fs";
import { isGlob, resolve } from "@std/path";

export async function expandInputExpression(
  expression: string,
): Promise<string[]> {
  if (expression === "-") {
    return [expression];
  }

  if (!isGlob(expression)) {
    return [resolve(expression)];
  }

  const matches: string[] = [];
  for await (const entry of expandGlob(expression, { includeDirs: false })) {
    matches.push(entry.path);
  }

  matches.sort();
  return matches;
}

export async function expandInputExpressions(
  expressions: readonly string[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const expression of expressions) {
    paths.push(...await expandInputExpression(expression));
  }
  return paths;
}
