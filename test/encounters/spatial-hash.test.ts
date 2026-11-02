import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LocationRecord, TimestampGroup } from "../../src/dataset/types.js";
import { detectEncounters } from "../../src/encounters/detect.js";
import { EARTH_RADIUS_METERS, haversineDistance } from "../../src/encounters/haversine.js";
import { latitudeSweep } from "../../src/encounters/latitude-sweep.js";
import { allPairs, type PairSearch } from "../../src/encounters/pair-search.js";
import {
  CELL_DISTANCE_METERS,
  gridColumns,
  ROW_HEIGHT_DEGREES,
  spatialHash,
} from "../../src/encounters/spatial-hash.js";
import { record } from "./records.js";

const TIMESTAMP = "2024-01-01 00:00:00";

function group(records: readonly LocationRecord[]): TimestampGroup {
  return { timestamp: TIMESTAMP, records };
}

function at(id: number, latitude: number, longitude: number, overrides: Partial<LocationRecord> = {}): LocationRecord {
  return record(id, { latitude, longitude, ...overrides });
}

/** Pairs visited by a strategy, as input indexes [i, j], in visiting order. */
function visitedPairs(search: PairSearch, records: readonly LocationRecord[]): [number, number][] {
  const index = new Map(records.map((item, position) => [item, position]));
  const pairs: [number, number][] = [];
  search(records, (a, b) => pairs.push([index.get(a) as number, index.get(b) as number]));
  return pairs;
}

/** Same encounters with `search` as with the brute-force oracle, plus the visit invariants (I-01, I-02, RS-08). */
function assertEquivalent(search: PairSearch, records: readonly LocationRecord[], label = ""): void {
  assert.deepStrictEqual(
    detectEncounters(group(records), search),
    detectEncounters(group(records), allPairs),
    `encounters differ ${label}`,
  );

  const visited = visitedPairs(search, records);
  const keys = visited.map(([i, j]) => `${i}:${j}`);
  assert.equal(new Set(keys).size, keys.length, `a pair was visited twice ${label}`);
  for (const [i, j] of visited) assert.ok(i < j, `pair ${i}:${j} not in input order ${label}`);
  const sorted = [...visited].sort(([a, b], [c, d]) => a - c || b - d);
  assert.deepEqual(visited, sorted, `pairs not in allPairs order ${label}`);

  const visitedKeys = new Set(keys);
  for (const [i, j] of visitedPairs(allPairs, records)) {
    const a = records[i] as LocationRecord;
    const b = records[j] as LocationRecord;
    if (haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude) < 20) {
      assert.ok(visitedKeys.has(`${i}:${j}`), `close pair ${i}:${j} not visited ${label}`);
    }
  }
}

/** Point at `meters` from (lat, lon) along `bearing` radians, on a sphere of radius R. */
function destination(lat: number, lon: number, bearing: number, meters: number): [number, number] {
  const toRad = Math.PI / 180;
  const angle = meters / EARTH_RADIUS_METERS;
  const phi1 = lat * toRad;
  const lambda1 = lon * toRad;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angle) + Math.cos(phi1) * Math.sin(angle) * Math.cos(bearing));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(phi1), Math.cos(angle) - Math.sin(phi1) * Math.sin(phi2));
  let longitude = lambda2 / toRad;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return [Math.max(-90, Math.min(90, phi2 / toRad)), longitude];
}

/** Deterministic pseudo-random generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("grid dimensions", () => {
  test("row height covers the threshold plus the safety margin", () => {
    assert.equal(CELL_DISTANCE_METERS, 20 * 1.001);
    assert.equal(ROW_HEIGHT_DEGREES, (CELL_DISTANCE_METERS / EARTH_RADIUS_METERS) * (180 / Math.PI));
  });

  test("columns are equal, at least as wide as needed and widen with latitude", () => {
    let previous = 0;
    for (const latitude of [0, 10, 33.75, 60, 80, 89, 89.99]) {
      const columns = gridColumns(latitude);
      const needed =
        2 *
        Math.asin(Math.sin(CELL_DISTANCE_METERS / (2 * EARTH_RADIUS_METERS)) / Math.cos((latitude * Math.PI) / 180)) *
        (180 / Math.PI);
      assert.ok(columns.count >= 3, `latitude ${latitude}`);
      assert.ok(Number.isInteger(columns.count));
      assert.ok(columns.widthDegrees >= needed, `latitude ${latitude}`);
      assert.ok(Math.abs(columns.widthDegrees * columns.count - 360) < 1e-9);
      assert.ok(columns.widthDegrees > previous);
      previous = columns.widthDegrees;
    }
  });

  test("at the equator a column spans the same angle as a row", () => {
    assert.ok(Math.abs(gridColumns(0).widthDegrees - ROW_HEIGHT_DEGREES) / ROW_HEIGHT_DEGREES < 1e-6);
  });

  test("uses a single column near the poles", () => {
    assert.deepEqual(gridColumns(90), { count: 1, widthDegrees: 360 });
    assert.deepEqual(gridColumns(89.99999), { count: 1, widthDegrees: 360 });
  });
});

const OPTIMIZED: readonly [string, PairSearch][] = [
  ["spatialHash", spatialHash],
  ["latitudeSweep", latitudeSweep],
];

for (const [name, search] of OPTIMIZED) {
  describe(`${name} constructed cases`, () => {
    test("groups with fewer than two records visit nothing", () => {
      assert.deepEqual(visitedPairs(search, []), []);
      assert.deepEqual(visitedPairs(search, [at(1, 0, 0)]), []);
    });
  
    test("positions in the same cell", () => {
      const records = [at(1, -25.59386, -73.96319), at(2, -25.59387, -73.9632), at(3, -25.59386, -73.96319)];
      assertEquivalent(search, records);
      assert.equal(detectEncounters(group(records), search).length, 3);
    });
  
    test("close positions in neighboring rows, columns and diagonals", () => {
      for (const bearing of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2]) {
        for (const [lat, lon] of [
          [-31.93195, -40.61438],
          [1.83355, -69.5461],
          [45.5, 10.25],
          [-70, 120],
        ] as const) {
          const [lat2, lon2] = destination(lat, lon, bearing, 19.5);
          const records = [at(1, lat, lon), at(2, lat2, lon2)];
          assertEquivalent(search, records, `bearing ${bearing} at ${lat},${lon}`);
          assert.equal(detectEncounters(group(records), search).length, 1);
        }
      }
    });
  
    test("positions on and around row and column borders", () => {
      const latitude = -25.5;
      const columns = gridColumns(Math.abs(latitude) + 1e-6);
      const rowBorder = Math.floor((latitude + 90) / ROW_HEIGHT_DEGREES) * ROW_HEIGHT_DEGREES - 90;
      const columnBorder = Math.floor((-40 + 180) / columns.widthDegrees) * columns.widthDegrees - 180;
      const epsilon = 1e-9;
      const records = [
        at(1, rowBorder, -40),
        at(2, rowBorder - epsilon, -40),
        at(3, rowBorder + ROW_HEIGHT_DEGREES * 0.5, -40),
        at(4, rowBorder - ROW_HEIGHT_DEGREES * 0.5, -40),
        at(5, latitude, columnBorder),
        at(6, latitude, columnBorder - epsilon),
        at(7, latitude, columnBorder + columns.widthDegrees * 0.4),
        at(8, latitude, columnBorder - columns.widthDegrees * 0.4),
        at(9, rowBorder - epsilon, columnBorder - epsilon),
        at(10, rowBorder + epsilon, columnBorder + epsilon),
      ];
      assertEquivalent(search, records);
      assert.ok(detectEncounters(group(records), search).length >= 8);
    });
  
    test("positive and negative coordinates around the equator and the prime meridian", () => {
      const records = [at(1, 0.00001, 0.00001), at(2, -0.00001, -0.00001), at(3, 0.00008, -0.00008), at(4, -0.0001, 0.0001)];
      assertEquivalent(search, records);
      assert.ok(detectEncounters(group(records), search).length >= 3);
    });
  
    test("pairs across the antimeridian", () => {
      const records = [at(1, -16.5, 179.99995), at(2, -16.5, -179.99995), at(3, -16.5, 180), at(4, -16.5, -180)];
      assertEquivalent(search, records);
      assert.equal(detectEncounters(group(records), search).length, 6);
    });
  
    test("high latitudes and the poles", () => {
      const north = [at(1, 89.9999, 0), at(2, 89.9999, 179), at(3, 90, -45), at(4, 89.99985, 90)];
      const south = [at(5, -89.99995, 10), at(6, -89.99995, -170), at(7, -90, 0)];
      const high = [at(8, 80, 30), ...[0, 1, 2].map((k) => at(9 + k, ...destination(80, 30, k, 19.9)))];
      for (const records of [north, south, high, [...north, ...south, ...high]]) {
        assertEquivalent(search, records);
      }
      assert.ok(detectEncounters(group(north), search).length >= 3);
      assert.equal(detectEncounters(group(high), search).filter((e) => e.first.id === 8).length, 3);
    });
  
    test("a high-latitude record widens the columns of the whole group", () => {
      const [lat2, lon2] = destination(60, 5, Math.PI / 2, 19.9);
      const records = [at(1, 60, 5), at(2, lat2, lon2), at(3, -10, -50)];
      assertEquivalent(search, records);
      assert.equal(detectEncounters(group(records), search).length, 1);
    });
  
    test("distances just below, exactly equal and just above 20 m", () => {
      const exact = [at(1, 0, -40), at(2, 0.00017986432118374611, -40)];
      assert.equal(haversineDistance(0, -40, 0.00017986432118374611, -40), 20);
      assertEquivalent(search, exact);
      assert.deepEqual(detectEncounters(group(exact), search), []);
  
      for (const [meters, expected] of [
        [19.999999, 1],
        [20.000001, 0],
      ] as const) {
        for (const bearing of [0, 1, Math.PI / 2, 2.5]) {
          const [lat2, lon2] = destination(-20, -45, bearing, meters);
          const records = [at(1, -20, -45), at(2, lat2, lon2)];
          assertEquivalent(search, records);
          assert.equal(detectEncounters(group(records), search).length, expected, `${meters} m, bearing ${bearing}`);
        }
      }
    });
  
    test("many close individuals and repeated ids", () => {
      const rng = random(7);
      const records: LocationRecord[] = [];
      for (let id = 0; id < 60; id++) {
        records.push(at(id % 45, ...destination(-15, -47.9, rng() * 2 * Math.PI, rng() * 30), { faction: id % 3 }));
      }
      assertEquivalent(search, records);
      assert.ok(detectEncounters(group(records), search).length > 100);
    });
  });
  
  describe(`${name} properties on random groups`, () => {
    const centers: readonly [number, number][] = [
      [-25.6, -73.9],
      [5.27, -34.79],
      [-33.75, -60],
      [0, 0],
      [0, 180],
      [45, -120],
      [-60, 100],
      [80, 15],
      [-89.9999, 0],
      [89.99, 179.9999],
    ];
  
    test("equals the brute-force oracle on 400 seeded groups", () => {
      const rng = random(2024);
      for (let groupIndex = 0; groupIndex < 400; groupIndex++) {
        const records: LocationRecord[] = [];
        const size = 2 + Math.floor(rng() * 40);
        for (let id = 1; id <= size; id++) {
          const [lat, lon] = centers[Math.floor(rng() * centers.length)] as [number, number];
          // Most records spread over a few km; some packed near the threshold.
          const meters = rng() < 0.5 ? rng() * 3000 : 19.9 + rng() * 0.2;
          const anchor = rng() < 0.5 ? [lat, lon] : destination(lat, lon, rng() * 2 * Math.PI, rng() * 40);
          const [pointLat, pointLon] = destination(anchor[0] as number, anchor[1] as number, rng() * 2 * Math.PI, meters);
          records.push(at(id, pointLat, pointLon, { faction: rng() < 0.2 ? 1 : null }));
        }
        assertEquivalent(search, records, `group ${groupIndex}`);
      }
    });
  });
}
