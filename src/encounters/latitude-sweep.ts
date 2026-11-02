import type { LocationRecord } from "../dataset/types.js";
import { EARTH_RADIUS_METERS } from "./haversine.js";
import type { PairSearch } from "./pair-search.js";
import { CELL_DISTANCE_METERS, ROW_HEIGHT_DEGREES } from "./spatial-hash.js";

const RADIANS_PER_DEGREE = Math.PI / 180;
const SIN_HALF_CELL_ANGLE = Math.sin(CELL_DISTANCE_METERS / EARTH_RADIUS_METERS / 2);

/**
 * Necessary condition on longitudes for a distance below the cell distance
 * (spec 003, plan section 3.2): cos Φ · |sin(Δλ/2)| < sin(D'/2R), with Φ the
 * larger |latitude| of the pair. |sin(Δλ/2)| is the same for the direct and
 * the circular difference, so pairs across the antimeridian need no special
 * case, and near the poles cos Φ ≈ 0 lets every longitude through.
 */
function longitudesMayMeet(a: LocationRecord, b: LocationRecord): boolean {
  const maxAbsLatitude = Math.max(Math.abs(a.latitude), Math.abs(b.latitude));
  const halfLongitudeDifference = ((a.longitude - b.longitude) * RADIANS_PER_DEGREE) / 2;
  return (
    Math.cos(maxAbsLatitude * RADIANS_PER_DEGREE) * Math.abs(Math.sin(halfLongitudeDifference)) < SIN_HALF_CELL_ANGLE
  );
}

/**
 * Latitude sweep strategy: sorts the group by latitude and compares each record
 * only with the next ones whose latitude differs by at most the row height of
 * `spatialHash`, then filters them by longitude. Both filters are the necessary
 * conditions of spec 003 (plan sections 3.1 and 3.2), so every pair closer than
 * 20 m is visited. The candidates are sorted before the visits, so each pair is
 * visited exactly once, earlier record first, in the same relative order as
 * `allPairs` (spec 003, plan section 12).
 */
export const latitudeSweep: PairSearch = (records, visit) => {
  const n = records.length;
  if (n < 2) return;

  const latitudes = new Float64Array(n);
  const byLatitude = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    latitudes[i] = (records[i] as LocationRecord).latitude;
    byLatitude[i] = i;
  }
  byLatitude.sort((x, y) => (latitudes[x] as number) - (latitudes[y] as number));

  // Candidate pairs as i * n + j with i < j, so a numeric sort gives the order of `allPairs`.
  const candidates: number[] = [];
  for (let p = 0; p < n; p++) {
    const i = byLatitude[p] as number;
    const latitude = latitudes[i] as number;
    for (let q = p + 1; q < n; q++) {
      const j = byLatitude[q] as number;
      if ((latitudes[j] as number) - latitude > ROW_HEIGHT_DEGREES) break;
      if (longitudesMayMeet(records[i] as LocationRecord, records[j] as LocationRecord)) {
        candidates.push(i < j ? i * n + j : j * n + i);
      }
    }
  }

  if (candidates.length > 1) candidates.sort((x, y) => x - y);
  for (const pair of candidates) {
    visit(records[Math.floor(pair / n)] as LocationRecord, records[pair % n] as LocationRecord);
  }
};
