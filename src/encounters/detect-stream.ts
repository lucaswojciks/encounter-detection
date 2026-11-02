import type { TimestampGroup } from "../dataset/types.js";
import { detectEncounters } from "./detect.js";
import { allPairs, type PairSearch } from "./pair-search.js";
import type { Encounter } from "./types.js";

/**
 * Detects encounters group by group. The next group is only requested after
 * the encounters of the current one have been consumed, so no state crosses
 * groups and memory stays bounded by one group.
 */
export async function* detectDatasetEncounters(
  groups: AsyncIterable<TimestampGroup>,
  search: PairSearch = allPairs,
): AsyncGenerator<Encounter, void, undefined> {
  for await (const group of groups) {
    yield* detectEncounters(group, search);
  }
}
