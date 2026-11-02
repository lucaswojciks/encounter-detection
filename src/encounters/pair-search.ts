import type { LocationRecord } from "../dataset/types.js";

/**
 * Strategy that calls `visit` for each candidate pair of records of one group.
 * A strategy may only reduce the candidates; the exact distance always decides
 * whether a candidate is an encounter.
 */
export type PairSearch = (
  records: readonly LocationRecord[],
  visit: (a: LocationRecord, b: LocationRecord) => void,
) => void;

/** Reference strategy: every pair i < j, in input order. */
export const allPairs: PairSearch = (records, visit) => {
  for (let i = 0; i < records.length; i++) {
    const a = records[i] as LocationRecord;
    for (let j = i + 1; j < records.length; j++) {
      visit(a, records[j] as LocationRecord);
    }
  }
};
