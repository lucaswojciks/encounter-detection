import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { readDataset } from "../../src/dataset/read-dataset.js";
import { detectDatasetEncounters } from "../../src/encounters/detect-stream.js";
import { type OutputEncounter, toOutputEncounter } from "../../src/encounters/output.js";
import { allPairs, type PairSearch } from "../../src/encounters/pair-search.js";
import { spatialHash } from "../../src/encounters/spatial-hash.js";
import { FIXTURES, readOfficialAnswers } from "./official-answers.js";

const CASES = [
  { dataset: "dataset1.txt", answers: "respostas1.json", count: 4 },
  { dataset: "dataset2.txt", answers: "respostas2.json", count: 6 },
] as const;

const STRATEGIES: readonly [string, PairSearch][] = [
  ["allPairs", allPairs],
  ["spatialHash", spatialHash],
];

async function detect(dataset: string, search: PairSearch): Promise<OutputEncounter[]> {
  const encounters: OutputEncounter[] = [];
  const path = fileURLToPath(new URL(dataset, FIXTURES));
  for await (const encounter of detectDatasetEncounters(readDataset(path), search)) {
    encounters.push(toOutputEncounter(encounter));
  }
  return encounters;
}

for (const [strategy, search] of STRATEGIES) for (const { dataset, answers, count } of CASES) {
  describe(`official ${dataset} with ${strategy}`, async () => {
    const detected = await detect(dataset, search);
    const expected = readOfficialAnswers(answers);

    test(`reproduces exactly the ${count} official encounters`, () => {
      assert.equal(expected.length, count);
      assert.equal(detected.length, count, "no missing or additional encounters");
      for (const [index, encounter] of expected.entries()) {
        assert.deepStrictEqual(detected[index], encounter, `encounter ${index}`);
      }
    });

    test("distances are bit-for-bit equal to the official ones", () => {
      for (const [index, encounter] of expected.entries()) {
        assert.ok(Object.is(detected[index]?.distanciaMetros, encounter.distanciaMetros), `encounter ${index}`);
      }
    });

    test("serializes to the same text as the official file", () => {
      const official = readFileSync(new URL(answers, FIXTURES), "utf8");
      assert.equal(JSON.stringify(detected, null, 2), official);
    });
  });
}
