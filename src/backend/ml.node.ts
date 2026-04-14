import { readFile } from "node:fs/promises";

import type { FacetClassifierArtifact } from "./ml.js";

export async function loadFacetClassifierArtifact(
  artifactPath: string,
): Promise<FacetClassifierArtifact> {
  const content = await readFile(artifactPath, "utf8");
  return JSON.parse(content) as FacetClassifierArtifact;
}
