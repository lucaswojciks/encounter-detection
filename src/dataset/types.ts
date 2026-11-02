export interface LocationRecord {
  readonly id: number;
  /** `null` when the individual has no faction. */
  readonly faction: number | null;
  /** Timestamp text exactly as in the input, without the delimiting quotes. */
  readonly timestamp: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly hasProtectiveMeasure: boolean;
  /** Empty when the input field is empty. */
  readonly restrictedIds: readonly number[];
}

export interface TimestampGroup {
  readonly timestamp: string;
  readonly records: readonly LocationRecord[];
}
