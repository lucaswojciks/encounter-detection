import type { LocationRecord } from "../dataset/types.js";

export type EncounterType = "generico" | "faccao" | "protetiva";

export interface Encounter {
  readonly type: EncounterType;
  readonly timestamp: string;
  /** Record of the individual with the smaller id. */
  readonly first: LocationRecord;
  /** Record of the individual with the larger id. */
  readonly second: LocationRecord;
  readonly distanceMeters: number;
}
