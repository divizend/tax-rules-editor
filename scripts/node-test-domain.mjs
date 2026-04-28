import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(repoRoot, "src", "domain", "__tests__");

async function listTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listTestFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) results.push(fullPath);
  }
  return results;
}

const testFiles = (await listTestFiles(testsRoot)).sort();

if (testFiles.length === 0) {
  console.error(`No test files found under ${testsRoot}`);
  process.exitCode = 1;
} else {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", ...testFiles],
    { stdio: "inherit" },
  );
  child.on("exit", (code, signal) => {
    if (typeof code === "number") process.exitCode = code;
    else process.exitCode = signal ? 1 : 0;
  });
}
