import { readFile } from "node:fs/promises";

import type { RuntimeBundle } from "./runtimeBundle.js";

export async function loadRuntimeBundle(bundlePath: string): Promise<RuntimeBundle> {
  const content = await readFile(bundlePath, "utf8");
  return JSON.parse(content) as RuntimeBundle;
}
