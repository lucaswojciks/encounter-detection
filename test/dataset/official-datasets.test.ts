import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { readDataset } from "../../src/dataset/read-dataset.js";
import type { LocationRecord, TimestampGroup } from "../../src/dataset/types.js";

// Compiled tests run from dist/test/dataset; fixtures stay in the source tree.
const FIXTURES = new URL("../../../test/fixtures/official/", import.meta.url);

interface OfficialEncounter {
  readonly timestamp: string;
  readonly posicoes: Record<string, { readonly lat: number; readonly lon: number }>;
}

interface Expectation {
  readonly dataset: string;
  readonly answers: string;
  readonly groups: number;
  readonly recordsPerGroup: number;
  readonly firstTimestamp: string;
  readonly lastTimestamp: string;
  /** Faction of every individual that has one (from dataset-analysis.md). */
  readonly factions: Record<number, number>;
  /** Restriction list of every individual that has one (from dataset-analysis.md). */
  readonly restrictions: Record<number, number[]>;
}

const EXPECTATIONS: readonly Expectation[] = [
  {
    dataset: "dataset1.txt",
    answers: "respostas1.json",
    groups: 500,
    recordsPerGroup: 10,
    firstTimestamp: "2024-01-01 00:00:00",
    lastTimestamp: "2024-01-01 00:41:35",
    factions: { 7: 1, 8: 1 },
    restrictions: { 9: [10] },
  },
  {
    dataset: "dataset2.txt",
    answers: "respostas2.json",
    groups: 1250,
    recordsPerGroup: 20,
    firstTimestamp: "2024-01-01 00:00:00",
    lastTimestamp: "2024-01-01 01:44:05",
    factions: { 8: 1, 9: 1, 10: 2, 11: 2 },
    restrictions: { 12: [13] },
  },
];

/**
 * Independent reference: reads the whole (small) fixture at once and converts
 * each field with the simplest expression that matches the official format.
 */
function referenceRecords(path: string): LocationRecord[] {
  const [, ...lines] = readFileSync(path, "utf8").split("\n");
  return lines.map((line) => {
    const [id, faction, timestamp, latitude, longitude, protectiveMeasure, restrictedIds] = line.split(";") as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      id: Number(id),
      faction: faction === "" ? null : Number(faction),
      timestamp: timestamp.replaceAll('"', ""),
      latitude: Number(latitude),
      longitude: Number(longitude),
      hasProtectiveMeasure: protectiveMeasure === "true",
      restrictedIds: restrictedIds === "" ? [] : restrictedIds.replaceAll('"', "").split(",").map(Number),
    };
  });
}

async function readGroups(path: string): Promise<TimestampGroup[]> {
  const groups: TimestampGroup[] = [];
  for await (const group of readDataset(path)) groups.push(group);
  return groups;
}

for (const expected of EXPECTATIONS) {
  describe(`official ${expected.dataset}`, async () => {
    const path = fileURLToPath(new URL(expected.dataset, FIXTURES));
    const groups = await readGroups(path);
    const records = groups.flatMap((group) => group.records);

    test("record and group counts", () => {
      assert.equal(records.length, expected.groups * expected.recordsPerGroup);
      assert.equal(groups.length, expected.groups);
      for (const group of groups) {
        assert.equal(group.records.length, expected.recordsPerGroup, group.timestamp);
      }
    });

    test("groups follow the input order and contain only their own timestamp", () => {
      assert.equal(groups[0]?.timestamp, expected.firstTimestamp);
      assert.equal(groups.at(-1)?.timestamp, expected.lastTimestamp);
      assert.equal(new Set(groups.map((group) => group.timestamp)).size, groups.length);
      for (const group of groups) {
        assert.ok(group.records.every((record) => record.timestamp === group.timestamp), group.timestamp);
      }
    });

    test("every field matches an independent reading of the file", () => {
      assert.deepEqual(records, referenceRecords(path));
    });

    test("factions and restriction lists", () => {
      for (const group of groups) {
        for (const record of group.records) {
          assert.equal(record.faction, expected.factions[record.id] ?? null, `faction of ${record.id}`);
          assert.deepEqual(record.restrictedIds, expected.restrictions[record.id] ?? [], `restrictions of ${record.id}`);
          assert.equal(record.hasProtectiveMeasure, record.id in expected.restrictions, `measure of ${record.id}`);
        }
      }
    });

    test("positions in the official answers equal the parsed coordinates", () => {
      const answers = JSON.parse(readFileSync(new URL(expected.answers, FIXTURES), "utf8")) as OfficialEncounter[];
      assert.ok(answers.length > 0);

      const byTimestamp = new Map(groups.map((group) => [group.timestamp, group]));
      for (const answer of answers) {
        const group = byTimestamp.get(answer.timestamp);
        assert.ok(group, `missing timestamp ${answer.timestamp}`);
        for (const [id, position] of Object.entries(answer.posicoes)) {
          const record: LocationRecord | undefined = group.records.find((candidate) => candidate.id === Number(id));
          assert.ok(record, `missing id ${id} at ${answer.timestamp}`);
          assert.equal(record.latitude, position.lat);
          assert.equal(record.longitude, position.lon);
        }
      }
    });
  });
}
