import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

function runCli(args: readonly string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
}

test("prints usage and exits with 0 when --help is given", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Usage: encounter-detection/);
});

test("reports the missing dataset and exits with 2 when no arguments are given", () => {
  const result = runCli([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /^error: missing dataset path\n\nUsage: encounter-detection/);
});
