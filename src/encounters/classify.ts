import type { LocationRecord } from "../dataset/types.js";
import type { EncounterType } from "./types.js";

/**
 * Type of an encounter between two records (spec 002, R-05 to R-07).
 *
 * The conditions are checked in a fixed order only so that a single type is
 * returned; that order is an implementation detail, not a business rule
 * (decision D1). No official dataset has a pair matching both conditions.
 */
export function classifyEncounter(a: LocationRecord, b: LocationRecord): EncounterType {
  if (a.restrictedIds.includes(b.id) || b.restrictedIds.includes(a.id)) return "protetiva";
  if (a.faction !== null && a.faction === b.faction) return "faccao";
  return "generico";
}
