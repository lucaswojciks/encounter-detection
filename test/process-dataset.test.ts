import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, test } from "node:test";

import { DatasetError } from "../src/dataset/dataset-error.js";
import { HEADER } from "../src/dataset/parse-record.js";
import { allPairs, type PairSearch } from "../src/encounters/pair-search.js";
import { processDataset } from "../src/process-dataset.js";
import { answerPath, officialDataset, skipWithout } from "./official-data.js";
import { SAMPLE, sampleDataset } from "./sample-dataset.js";

describe("processDataset", () => {
  let directory: string;
  let sample: string;
  let counter = 0;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "encounter-process-"));
    sample = await datasetWith([sampleDataset()]);
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const outputPath = () => join(directory, `out-${counter++}.json`);

  async function datasetWith(lines: readonly string[]): Promise<string> {
    const path = join(directory, `dataset-${counter++}.txt`);
    await writeFile(path, lines.join("\n"), "utf8");
    return path;
  }

  test("processes the sample dataset into its planted encounters, with statistics", async () => {
    const output = outputPath();
    const result = await processDataset({ input: sample, output });

    assert.equal(result.records, SAMPLE.records);
    assert.equal(result.timestamps, SAMPLE.timestamps);
    assert.equal(result.encounters, SAMPLE.encounters.length);
    assert.deepEqual(result.byType, SAMPLE.byType);
    assert.ok(result.durationMs > 0);
    const written = JSON.parse(await readFile(output, "utf8")) as {
      tipo: string;
      monitoradosEncontro: number[];
      timestamp: string;
    }[];
    assert.deepEqual(
      written.map(({ tipo, monitoradosEncontro, timestamp }) => ({ tipo, ids: monitoradosEncontro, timestamp })),
      SAMPLE.encounters,
    );
  });

  test("the default strategy and allPairs write the same file for the sample dataset", async () => {
    const defaultOutput = outputPath();
    const allPairsOutput = outputPath();
    await processDataset({ input: sample, output: defaultOutput });
    await processDataset({ input: sample, output: allPairsOutput, search: allPairs });

    assert.equal(await readFile(defaultOutput, "utf8"), await readFile(allPairsOutput, "utf8"));
  });

  test("processes official dataset 1 into the official answer", { skip: skipWithout("dataset1.txt") }, async () => {
    const output = outputPath();
    const result = await processDataset({ input: officialDataset("dataset1.txt") as string, output });

    assert.equal(result.records, 5000);
    assert.equal(result.timestamps, 500);
    assert.equal(result.encounters, 4);
    assert.deepEqual(result.byType, { generico: 2, faccao: 1, protetiva: 1 });
    assert.equal(await readFile(output, "utf8"), await readFile(answerPath("respostas1.json"), "utf8"));
  });

  test(
    "the default strategy and allPairs write the official answer for dataset 2",
    { skip: skipWithout("dataset2.txt") },
    async () => {
      const input = officialDataset("dataset2.txt") as string;
      const defaultOutput = outputPath();
      const allPairsOutput = outputPath();
      await processDataset({ input, output: defaultOutput });
      await processDataset({ input, output: allPairsOutput, search: allPairs });

      const expected = await readFile(answerPath("respostas2.json"), "utf8");
      assert.equal(await readFile(defaultOutput, "utf8"), expected);
      assert.equal(await readFile(allPairsOutput, "utf8"), expected);
    },
  );

  test("uses the given strategy", async () => {
    let calls = 0;
    const counting: PairSearch = (records, visit) => {
      calls++;
      allPairs(records, visit);
    };
    await processDataset({ input: sample, output: outputPath(), search: counting });
    assert.equal(calls, SAMPLE.timestamps);
  });

  test("a dataset without encounters, or with only the header, produces []", async () => {
    const farApart = await datasetWith([
      HEADER,
      '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;',
      '2;;"2024-01-01 00:00:00";-21.15463;-61.43519;false;',
    ]);
    for (const input of [farApart, await datasetWith([HEADER])]) {
      const output = outputPath();
      const result = await processDataset({ input, output });
      assert.equal(result.encounters, 0);
      assert.equal(await readFile(output, "utf8"), "[]");
    }
  });

  test("an input error leaves no output file", async () => {
    const input = await datasetWith([HEADER, '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;', "broken"]);
    const output = outputPath();
    const before = await readdir(directory);

    await assert.rejects(processDataset({ input, output }), (error: unknown) => {
      assert.ok(error instanceof DatasetError);
      assert.equal(error.lineNumber, 3);
      return true;
    });
    assert.deepEqual(await readdir(directory), before);
  });

  test("refuses an output path that is the input dataset, keeping the dataset intact", async () => {
    const content = [HEADER, '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;'].join("\n");
    const input = await datasetWith(content.split("\n"));
    const sameFile = join(directory, ".", basename(input));

    for (const output of [input, sameFile]) {
      await assert.rejects(processDataset({ input, output }), {
        message: `output ${output} is the input dataset ${input}; choose another output path`,
      });
      assert.equal(await readFile(input, "utf8"), content);
    }
  });

  test("aborting stops before the next group and leaves no output file", async () => {
    const controller = new AbortController();
    let groups = 0;
    const abortOnThirdGroup: PairSearch = (records, visit) => {
      if (++groups === 3) controller.abort();
      allPairs(records, visit);
    };
    const output = outputPath();
    const before = await readdir(directory);

    await assert.rejects(
      processDataset({ input: sample, output, search: abortOnThirdGroup, signal: controller.signal }),
      { name: "AbortError" },
    );
    assert.equal(groups, 3);
    assert.deepEqual(await readdir(directory), before);
  });
});
