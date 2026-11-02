import type { LocationRecord } from "../../src/dataset/types.js";

/** Builds a record for tests; unspecified attributes are "no faction, no restrictions". */
export function record(id: number, overrides: Partial<LocationRecord> = {}): LocationRecord {
  return {
    id,
    faction: null,
    timestamp: "2024-01-01 00:00:00",
    latitude: -25.59386,
    longitude: -73.96319,
    hasProtectiveMeasure: false,
    restrictedIds: [],
    ...overrides,
  };
}
