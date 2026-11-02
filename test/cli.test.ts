import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const OFFICIAL = new URL("../../test/fixtures/official/", import.meta.url);
const official = (name: string) => fileURLToPath(new URL(name, OFFICIAL));
const HEADER = "idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida";

function runCli(args: readonly string[], cwd?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8", cwd });
}

describe("CLI", () => {
  let directory: string;
  let counter = 0;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "encounter-cli-"));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function freshDirectory(): Promise<string> {
    const dir = join(directory, `case-${counter++}`);
    await mkdir(dir);
    return dir;
  }

  test("--help prints usage and exits with 0", () => {
    const result = runCli(["--help"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Usage: encounter-detection <dataset> \[--output <file\.json>\] \[--search spatial\|all\]/);
    assert.equal(result.stderr, "");
  });

  test("invalid arguments exit with 2 and show the usage", () => {
    for (const [args, message] of [
      [[], "missing dataset path"],
      [["a.txt", "b.txt"], "expected one dataset path"],
      [["a.txt", "--search", "fast"], 'invalid --search "fast"'],
      [["a.txt", "--output"], "argument missing"],
      [["a.txt", "--unknown"], "Unknown option '--unknown'"],
    ] as const) {
      const result = runCli(args);
      assert.equal(result.status, 2, args.join(" "));
      assert.ok(result.stderr.startsWith(`error: `), result.stderr);
      assert.ok(result.stderr.includes(message), result.stderr);
      assert.ok(result.stderr.includes("Usage: encounter-detection"));
      assert.equal(result.stdout, "");
    }
  });

  test("dataset 1 with defaults: spatialHash, default output name, official answer", async () => {
    const cwd = await freshDirectory();
    const result = runCli([official("dataset1.txt")], cwd);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = join(cwd, "outputs", "encontros-dataset1.json");
    assert.equal(await readFile(output, "utf8"), await readFile(official("respostas1.json"), "utf8"));
    assert.match(result.stdout, /^Search: {5}spatialHash$/m);
    assert.match(result.stdout, /^Output: {5}outputs[\\/]encontros-dataset1\.json$/m);
    assert.match(result.stdout, /^Records: {4}5000$/m);
    assert.match(result.stdout, /^Timestamps: 500$/m);
    assert.match(result.stdout, /^Encounters: 4 \(generico 2, faccao 1, protetiva 1\)$/m);
    assert.match(result.stdout, /^Duration: {3}\d+\.\d{3} s$/m);
    assert.match(result.stdout, /^Max RSS: {4}\d+\.\d MiB$/m);
  });

  test("dataset 2 with both strategies matches the official answer byte for byte", async () => {
    const dir = await freshDirectory();
    const expected = await readFile(official("respostas2.json"), "utf8");
    for (const [search, name] of [
      ["spatial", "spatialHash"],
      ["all", "allPairs"],
    ] as const) {
      const output = join(dir, `${search}.json`);
      const result = runCli([official("dataset2.txt"), "--search", search, "-o", output]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`^Search: {5}${name}$`, "m"));
      assert.match(result.stdout, /^Encounters: 6 \(generico 3, faccao 2, protetiva 1\)$/m);
      assert.equal(await readFile(output, "utf8"), expected, search);
    }
  });

  test("creates the parent directory of the output", async () => {
    const dir = await freshDirectory();
    const output = join(dir, "nested", "deeper", "out.json");
    const result = runCli([official("dataset1.txt"), "-o", output]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, "utf8"), await readFile(official("respostas1.json"), "utf8"));
  });

  test("a dataset without encounters produces []", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "empty.txt");
    await writeFile(input, `${HEADER}\n`, "utf8");
    const result = runCli([input, "-o", join(dir, "out.json")]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(dir, "out.json"), "utf8"), "[]");
    assert.match(result.stdout, /^Encounters: 0 \(generico 0, faccao 0, protetiva 0\)$/m);
  });

  test("an invalid dataset exits with 1, reports file, line and field, and writes nothing", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "invalid.txt");
    await writeFile(
      input,
      [HEADER, '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;', '2;;"2024-01-01 00:00:00";-95.0;-73.9;false;'].join(
        "\n",
      ),
      "utf8",
    );
    const output = join(dir, "out.json");
    const result = runCli([input, "-o", output]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`error: ${input}:3: field "latitude": "-95.0" is outside [-90, 90]`), result.stderr);
    assert.ok(result.stderr.includes(`${output} was not written`));
    assert.equal(result.stdout, "");
    assert.deepEqual(await readdir(dir), ["invalid.txt"]);
  });

  test("a failure keeps a previous output file intact", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "invalid.txt");
    await writeFile(input, [HEADER, "broken"].join("\n"), "utf8");
    const output = join(dir, "out.json");
    await writeFile(output, "previous result", "utf8");

    const result = runCli([input, "-o", output]);

    assert.equal(result.status, 1);
    assert.equal(await readFile(output, "utf8"), "previous result");
    assert.deepEqual((await readdir(dir)).sort(), ["invalid.txt", "out.json"]);
  });

  test("a missing dataset exits with 1 and names the file", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "missing.txt");
    const result = runCli([input, "-o", join(dir, "out.json")]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`error: ${input}: cannot read file: ENOENT`), result.stderr);
    assert.deepEqual(await readdir(dir), []);
  });

  test("an output path that cannot be written exits with 1", async () => {
    const dir = await freshDirectory();
    const output = join(dir, "is-a-directory");
    await mkdir(output);
    const result = runCli([official("dataset1.txt"), "-o", output]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.startsWith("error: "), result.stderr);
    assert.ok(result.stderr.includes(`${output} was not written`));
    assert.deepEqual(await readdir(dir), ["is-a-directory"]);
  });
});
