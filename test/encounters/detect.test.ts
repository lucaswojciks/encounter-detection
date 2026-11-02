import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LocationRecord, TimestampGroup } from "../../src/dataset/types.js";
import { detectEncounters, ENCOUNTER_DISTANCE_METERS } from "../../src/encounters/detect.js";
import { haversineDistance } from "../../src/encounters/haversine.js";
import { allPairs, type PairSearch } from "../../src/encounters/pair-search.js";
import type { Encounter } from "../../src/encounters/types.js";
import { record } from "./records.js";

const TIMESTAMP = "2024-01-01 00:05:15";
// About 9.3 m apart (official encounter 4-6 of dataset 1).
const NEAR_A = { latitude: -31.93195, longitude: -40.61438 };
const NEAR_B = { latitude: -31.93187, longitude: -40.61435 };
const FAR = { latitude: -21.15463, longitude: -61.43519 };

function group(records: readonly LocationRecord[]): TimestampGroup {
  return { timestamp: TIMESTAMP, records };
}

function summary(encounters: readonly Encounter[]): string[] {
  return encounters.map((e) => `${e.first.id}-${e.second.id}:${e.type}`);
}

/**
 * Latitudes north of 0 at which the distance from (0, 0) is just below and
 * just at or above the threshold, found by bisection on the formula itself.
 */
function thresholdLatitudes(): { below: number; atOrAbove: number } {
  let below = 0;
  let atOrAbove = 0.001; // about 111 m
  for (let i = 0; i < 200; i++) {
    const middle = (below + atOrAbove) / 2;
    if (middle === below || middle === atOrAbove) break;
    if (haversineDistance(0, 0, middle, 0) < ENCOUNTER_DISTANCE_METERS) below = middle;
    else atOrAbove = middle;
  }
  return { below, atOrAbove };
}

describe("detectEncounters", () => {
  test("the threshold is 20 meters", () => {
    assert.equal(ENCOUNTER_DISTANCE_METERS, 20);
  });

  test("a distance strictly below 20 m is an encounter; 20 m or more is not", () => {
    const { below, atOrAbove } = thresholdLatitudes();
    const distanceBelow = haversineDistance(0, 0, below, 0);
    const distanceAbove = haversineDistance(0, 0, atOrAbove, 0);
    assert.ok(distanceBelow < 20 && distanceBelow > 19.999999, `below: ${distanceBelow}`);
    assert.ok(distanceAbove >= 20 && distanceAbove < 20.000001, `at or above: ${distanceAbove}`);

    const origin = record(1, { latitude: 0, longitude: 0 });
    const inside = detectEncounters(group([origin, record(2, { latitude: below, longitude: 0 })]));
    const outside = detectEncounters(group([origin, record(2, { latitude: atOrAbove, longitude: 0 })]));

    assert.equal(inside.length, 1);
    assert.equal(inside[0]?.distanceMeters, distanceBelow);
    assert.deepEqual(outside, []);
  });

  test("groups with fewer than two records have no encounters", () => {
    assert.deepEqual(detectEncounters(group([])), []);
    assert.deepEqual(detectEncounters(group([record(1, NEAR_A)])), []);
  });

  test("detects a close pair with its distance, timestamp and records", () => {
    const a = record(4, NEAR_A);
    const b = record(6, NEAR_B);

    assert.deepEqual(detectEncounters(group([a, b])), [
      { type: "generico", timestamp: TIMESTAMP, first: a, second: b, distanceMeters: 9.33522817789823 },
    ]);
  });

  test("ignores distant pairs", () => {
    assert.deepEqual(detectEncounters(group([record(1, NEAR_A), record(2, FAR)])), []);
  });

  test("orders the ids of each encounter even when the larger id comes first", () => {
    const [encounter] = detectEncounters(group([record(6, NEAR_B), record(4, NEAR_A)]));

    assert.equal(encounter?.first.id, 4);
    assert.equal(encounter?.second.id, 6);
    assert.equal(encounter?.distanceMeters, 9.33522817789823);
  });

  test("three close records produce three encounters, ordered by smaller then larger id", () => {
    const records = [record(30, NEAR_A), record(2, NEAR_B), record(11, NEAR_A), record(5, FAR)];

    assert.deepEqual(summary(detectEncounters(group(records))), ["2-11:generico", "2-30:generico", "11-30:generico"]);
  });

  test("orders pairs numerically, not as text", () => {
    const records = [record(10, NEAR_A), record(9, NEAR_B), record(100, FAR), record(11, FAR)];

    assert.deepEqual(summary(detectEncounters(group(records))), ["9-10:generico", "11-100:generico"]);
  });

  test("the result does not depend on the input order", () => {
    const records = [
      record(1, NEAR_A),
      record(2, { ...NEAR_B, faction: 3 }),
      record(3, { ...NEAR_A, faction: 3 }),
      record(4, { ...NEAR_B, restrictedIds: [1] }),
      record(5, FAR),
    ];
    const expected = detectEncounters(group(records));
    const [r1, r2, r3, r4, r5] = records as [LocationRecord, LocationRecord, LocationRecord, LocationRecord, LocationRecord];

    assert.equal(expected.length, 6);
    assert.deepEqual(detectEncounters(group([...records].reverse())), expected);
    assert.deepEqual(detectEncounters(group([r3, r5, r1, r4, r2])), expected);
  });

  test("classifies each encounter", () => {
    const records = [
      record(7, { ...NEAR_A, faction: 1 }),
      record(8, { ...NEAR_B, faction: 1 }),
      record(9, { ...FAR, hasProtectiveMeasure: true, restrictedIds: [10] }),
      record(10, { latitude: FAR.latitude + 0.00005, longitude: FAR.longitude }),
    ];

    assert.deepEqual(summary(detectEncounters(group(records))), ["7-8:faccao", "9-10:protetiva"]);
  });

  test("an id repeated in the group is registered once per pair and never meets itself", () => {
    const first = record(1, NEAR_A);
    const repeated = record(1, NEAR_B);
    const other = record(2, NEAR_B);

    const encounters = detectEncounters(group([first, repeated, other]));

    assert.deepEqual(summary(encounters), ["1-2:generico"]);
    assert.equal(encounters[0]?.first, first, "the first combination in input order wins");
  });

  test("a strategy visiting the same candidate twice does not create duplicates", () => {
    const records = [record(1, NEAR_A), record(2, NEAR_B), record(3, FAR)];
    const twice: PairSearch = (items, visit) => {
      allPairs(items, visit);
      allPairs(items, visit);
    };

    assert.deepEqual(detectEncounters(group(records), twice), detectEncounters(group(records)));
  });

  test("a strategy visiting reversed, shuffled pairs gives the same result", () => {
    const records = [record(1, NEAR_A), record(2, NEAR_B), record(3, NEAR_A), record(4, FAR)];
    const reversedShuffled: PairSearch = (items, visit) => {
      const pairs: [LocationRecord, LocationRecord][] = [];
      allPairs(items, (a, b) => pairs.push([b, a]));
      for (const index of [3, 0, 5, 1, 4, 2]) {
        const [a, b] = pairs[index] as [LocationRecord, LocationRecord];
        visit(a, b);
      }
    };

    assert.deepEqual(detectEncounters(group(records), reversedShuffled), detectEncounters(group(records)));
  });
});
