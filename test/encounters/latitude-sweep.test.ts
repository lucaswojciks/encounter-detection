import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LocationRecord } from "../../src/dataset/types.js";
import { detectEncounters } from "../../src/encounters/detect.js";
import { latitudeSweep } from "../../src/encounters/latitude-sweep.js";
import { allPairs } from "../../src/encounters/pair-search.js";
import { ROW_HEIGHT_DEGREES } from "../../src/encounters/spatial-hash.js";
import { record } from "./records.js";

function at(id: number, latitude: number, longitude: number): LocationRecord {
  return record(id, { latitude, longitude });
}

function visitedIds(records: readonly LocationRecord[]): string[] {
  const visited: string[] = [];
  latitudeSweep(records, (a, b) => visited.push(`${a.id}-${b.id}`));
  return visited;
}

// The equivalence with `allPairs` (constructed cases and seeded random groups)
// is in spatial-hash.test.ts, which runs the same suite for both strategies.
describe("latitudeSweep candidates", () => {
  test("skips pairs whose latitudes differ by more than the row height", () => {
    assert.deepEqual(visitedIds([at(1, -25, -40), at(2, -25 + ROW_HEIGHT_DEGREES * 1.01, -40)]), []);
    assert.deepEqual(visitedIds([at(1, -25, -40), at(2, -25 + ROW_HEIGHT_DEGREES * 0.99, -40)]), ["1-2"]);
  });

  test("skips pairs on the same latitude that are far apart in longitude", () => {
    assert.deepEqual(visitedIds([at(1, -25, -40), at(2, -25, -39.99), at(3, -25, 140)]), []);
  });

  test("keeps pairs across the antimeridian", () => {
    assert.deepEqual(visitedIds([at(1, -16.5, 179.99995), at(2, -16.5, -179.99995), at(3, -16.5, 0)]), ["1-2"]);
  });

  test("near the poles every longitude is a candidate", () => {
    assert.deepEqual(visitedIds([at(1, 90, 0), at(2, 90, 120), at(3, -90, 10), at(4, -90, -170)]), ["1-2", "3-4"]);
  });

  test("visits in the order of allPairs whatever the latitude order", () => {
    const records = [at(5, 0.00009, 0), at(3, 0, 0), at(4, 0.00018, 0), at(1, -0.00005, 0)];
    assert.deepEqual(visitedIds(records), ["5-3", "5-4", "5-1", "3-4", "3-1"]);
  });

  test("many records on one parallel, all in the same latitude band, match allPairs", () => {
    const records = Array.from({ length: 50 }, (_, i) => at(i, 10, i * 0.0001));
    const group = { timestamp: "2024-01-01 00:00:00", records };
    assert.deepStrictEqual(detectEncounters(group, latitudeSweep), detectEncounters(group, allPairs));
  });
});
