import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { answerPath, officialDataset, skipWithout } from "./official-data.js";
import { SAMPLE, sampleDataset } from "./sample-dataset.js";

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const STRATEGIES = [
  ["sweep", "latitudeSweep"],
  ["spatial", "spatialHash"],
  ["all", "allPairs"],
] as const;
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
    assert.match(result.stdout, /^Usage: encounter-detection <dataset> \[--output <file\.json>\] \[--search sweep\|spatial\|all\]/);
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

  test("sample dataset with defaults: latitudeSweep, default output name, planted encounters", async () => {
    const cwd = await freshDirectory();
    await writeFile(join(cwd, "sample.txt"), sampleDataset(), "utf8");
    const result = runCli(["sample.txt"], cwd);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(await readFile(join(cwd, "outputs", "encontros-sample.json"), "utf8")) as {
      tipo: string;
      monitoradosEncontro: number[];
      timestamp: string;
    }[];
    assert.deepEqual(
      output.map(({ tipo, monitoradosEncontro, timestamp }) => ({ tipo, ids: monitoradosEncontro, timestamp })),
      SAMPLE.encounters,
    );
    assert.match(result.stdout, /^Search: {5}latitudeSweep$/m);
    assert.match(result.stdout, /^Output: {5}outputs[\\/]encontros-sample\.json$/m);
    assert.match(result.stdout, new RegExp(`^Records: {4}${SAMPLE.records}$`, "m"));
    assert.match(result.stdout, new RegExp(`^Timestamps: ${SAMPLE.timestamps}$`, "m"));
    assert.match(result.stdout, /^Encounters: 3 \(generico 1, faccao 1, protetiva 1\)$/m);
    assert.match(result.stdout, /^Duration: {3}\d+\.\d{3} s$/m);
    assert.match(result.stdout, /^Max RSS: {4}\d+\.\d MiB$/m);
  });

  test("every strategy writes the same file for the sample dataset", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "sample.txt");
    await writeFile(input, sampleDataset(), "utf8");
    const files: string[] = [];
    for (const [search, name] of STRATEGIES) {
      const output = join(dir, `${search}.json`);
      const result = runCli([input, "--search", search, "-o", output]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`^Search: {5}${name}$`, "m"));
      files.push(await readFile(output, "utf8"));
    }
    assert.deepEqual(new Set(files).size, 1);
  });

  test("official dataset 1 with defaults matches the official answer", { skip: skipWithout("dataset1.txt") }, async () => {
    const cwd = await freshDirectory();
    const result = runCli([officialDataset("dataset1.txt") as string], cwd);

    assert.equal(result.status, 0, result.stderr);
    const output = join(cwd, "outputs", "encontros-dataset1.json");
    assert.equal(await readFile(output, "utf8"), await readFile(answerPath("respostas1.json"), "utf8"));
    assert.match(result.stdout, /^Records: {4}5000$/m);
    assert.match(result.stdout, /^Timestamps: 500$/m);
    assert.match(result.stdout, /^Encounters: 4 \(generico 2, faccao 1, protetiva 1\)$/m);
  });

  test(
    "official dataset 2 with every strategy matches the official answer byte for byte",
    { skip: skipWithout("dataset2.txt") },
    async () => {
      const dir = await freshDirectory();
      const expected = await readFile(answerPath("respostas2.json"), "utf8");
      for (const [search, name] of STRATEGIES) {
        const output = join(dir, `${search}.json`);
        const result = runCli([officialDataset("dataset2.txt") as string, "--search", search, "-o", output]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, new RegExp(`^Search: {5}${name}$`, "m"));
        assert.match(result.stdout, /^Encounters: 6 \(generico 3, faccao 2, protetiva 1\)$/m);
        assert.equal(await readFile(output, "utf8"), expected, search);
      }
    },
  );

  test("creates the parent directory of the output", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "sample.txt");
    await writeFile(input, sampleDataset(), "utf8");
    const output = join(dir, "nested", "deeper", "out.json");
    const result = runCli([input, "-o", output]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal((JSON.parse(await readFile(output, "utf8")) as unknown[]).length, SAMPLE.encounters.length);
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

  test("an output path that is the input dataset exits with 1 and keeps the dataset", async () => {
    const dir = await freshDirectory();
    const input = join(dir, "dataset.txt");
    const content = [HEADER, '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;'].join("\n");
    await writeFile(input, content, "utf8");

    const result = runCli(["dataset.txt", "-o", "./dataset.txt"], dir);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("error: output ./dataset.txt is the input dataset dataset.txt"), result.stderr);
    assert.equal(await readFile(input, "utf8"), content);
    assert.deepEqual(await readdir(dir), ["dataset.txt"]);
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
    const input = join(dir, "sample.txt");
    await writeFile(input, sampleDataset(), "utf8");
    const output = join(dir, "is-a-directory");
    await mkdir(output);
    const result = runCli([input, "-o", output]);

    assert.equal(result.status, 1);
    assert.ok(result.stderr.startsWith("error: "), result.stderr);
    assert.ok(result.stderr.includes(`${output} was not written`));
    assert.deepEqual((await readdir(dir)).sort(), ["is-a-directory", "sample.txt"]);
  });
});
