import path from "node:path";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = process.cwd();

await runStep("Seed raw source tables", "node", ["scripts/seed-source-data.mjs"]);

const python = await resolvePython(root);
await runStep("Rebuild runtime artifacts", python, ["EDA/scripts/export_runtime_artifacts.py"]);

await runStep("Seed runtime bundle", "node", ["scripts/seed-demo.mjs"]);

console.log("Refreshed source tables and runtime bundle from local data.");

async function resolvePython(cwd) {
  const venvPython = path.join(cwd, ".venv", "bin", "python");
  try {
    await access(venvPython);
    return venvPython;
  } catch {
    return "python3";
  }
}

async function runStep(label, command, args) {
  console.log(`\n==> ${label}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      resolve();
    });
  });
}
