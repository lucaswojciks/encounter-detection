import type { LocationRecord } from "../dataset/types.js";
import { ENCOUNTER_DISTANCE_METERS } from "./detect.js";
import { EARTH_RADIUS_METERS } from "./haversine.js";
import type { PairSearch } from "./pair-search.js";

/**
 * Cells are sized for the threshold plus 0.1 %, which covers floating-point
 * error in the distance and in the cell indexes (spec 003, plan section 3.4).
 */
export const CELL_DISTANCE_METERS = ENCOUNTER_DISTANCE_METERS * 1.001;

const DEGREES_PER_RADIAN = 180 / Math.PI;
const CELL_ANGLE_RADIANS = CELL_DISTANCE_METERS / EARTH_RADIUS_METERS;
const SIN_HALF_CELL_ANGLE = Math.sin(CELL_ANGLE_RADIANS / 2);

/** Row height in degrees: pairs closer than the cell distance are in adjacent rows. */
export const ROW_HEIGHT_DEGREES = CELL_ANGLE_RADIANS * DEGREES_PER_RADIAN;

export interface GridColumns {
  /** Number of equal columns around the globe; 1 means no longitude filtering. */
  readonly count: number;
  readonly widthDegrees: number;
}

const SINGLE_COLUMN: GridColumns = { count: 1, widthDegrees: 360 };
const NEIGHBOR_COLUMNS = [-1, 0, 1] as const;
const OWN_COLUMN = [0] as const;

/**
 * Columns for a group whose largest |latitude| is `maxAbsLatitude`: pairs closer
 * than the cell distance are in the same or adjacent columns (modulo the column
 * count), because cos(latitude) shrinks the longitude span of a given distance.
 */
export function gridColumns(maxAbsLatitude: number): GridColumns {
  const ratio = SIN_HALF_CELL_ANGLE / Math.cos(maxAbsLatitude / DEGREES_PER_RADIAN);
  if (!(ratio < 1)) return SINGLE_COLUMN;
  const minWidthDegrees = 2 * Math.asin(ratio) * DEGREES_PER_RADIAN;
  const count = Math.floor(360 / minWidthDegrees);
  // With fewer than 3 columns, the neighbors -1, 0 and +1 would repeat columns.
  return count < 3 ? SINGLE_COLUMN : { count, widthDegrees: 360 / count };
}

/**
 * Spatial hashing strategy: indexes the group in a latitude/longitude grid and
 * visits only pairs in the same or neighboring cells. Every pair closer than
 * 20 m is visited exactly once, earlier record first, in the same relative
 * order as `allPairs` (spec 003, plan sections 3 and 5).
 */
export const spatialHash: PairSearch = (records, visit) => {
  const n = records.length;
  if (n < 2) return;

  let maxAbsLatitude = 0;
  for (const record of records) maxAbsLatitude = Math.max(maxAbsLatitude, Math.abs(record.latitude));
  const columns = gridColumns(maxAbsLatitude);
  const columnOffsets = columns.count === 1 ? OWN_COLUMN : NEIGHBOR_COLUMNS;

  const rowOf = new Int32Array(n);
  const columnOf = new Int32Array(n);
  const cells = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const record = records[i] as LocationRecord;
    const row = Math.floor((record.latitude + 90) / ROW_HEIGHT_DEGREES);
    const column = Math.floor((record.longitude + 180) / columns.widthDegrees) % columns.count;
    rowOf[i] = row;
    columnOf[i] = column;
    const key = row * columns.count + column;
    const cell = cells.get(key);
    if (cell === undefined) cells.set(key, [i]);
    else cell.push(i);
  }

  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = rowOf[i] as number;
    const column = columnOf[i] as number;
    candidates.length = 0;
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (const columnOffset of columnOffsets) {
        const neighborColumn = (column + columnOffset + columns.count) % columns.count;
        const cell = cells.get((row + rowOffset) * columns.count + neighborColumn);
        if (cell === undefined) continue;
        for (const j of cell) if (j > i) candidates.push(j);
      }
    }
    if (candidates.length === 0) continue;
    if (candidates.length > 1) candidates.sort((x, y) => x - y);
    const a = records[i] as LocationRecord;
    for (const j of candidates) visit(a, records[j] as LocationRecord);
  }
};
