import type { TimestampGroup } from "../dataset/types.js";
import { classifyEncounter } from "./classify.js";
import { haversineDistance } from "./haversine.js";
import { allPairs, type PairSearch } from "./pair-search.js";
import type { Encounter } from "./types.js";

/** An encounter requires a distance strictly below this value. */
export const ENCOUNTER_DISTANCE_METERS = 20;

/**
 * Encounters of one timestamp group, ordered by the smaller id and then the
 * larger id. Each unordered pair of ids produces at most one encounter; when an
 * id is repeated in the group, the first matching combination visited wins.
 */
export function detectEncounters(group: TimestampGroup, search: PairSearch = allPairs): Encounter[] {
  const encounters: Encounter[] = [];
  const seenPairs = new Set<string>();

  search(group.records, (a, b) => {
    if (a.id === b.id) return;
    const [first, second] = a.id < b.id ? [a, b] : [b, a];
    const distance = haversineDistance(first.latitude, first.longitude, second.latitude, second.longitude);
    if (!(distance < ENCOUNTER_DISTANCE_METERS)) return;

    const key = `${first.id}:${second.id}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    encounters.push({
      type: classifyEncounter(first, second),
      timestamp: group.timestamp,
      first,
      second,
      distanceMeters: distance,
    });
  });

  return encounters.sort((x, y) => x.first.id - y.first.id || x.second.id - y.second.id);
}
