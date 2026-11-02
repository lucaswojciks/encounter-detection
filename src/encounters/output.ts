import type { Encounter, EncounterType } from "./types.js";

export interface OutputPosition {
  readonly lat: number;
  readonly lon: number;
}

/** Encounter in the structure of the official answers, keys in the same order. */
export interface OutputEncounter {
  readonly tipo: EncounterType;
  readonly monitoradosEncontro: readonly [number, number];
  readonly timestamp: string;
  readonly posicoes: Readonly<Record<string, OutputPosition>>;
  readonly distanciaMetros: number;
}

export function toOutputEncounter(encounter: Encounter): OutputEncounter {
  const { first, second } = encounter;
  return {
    tipo: encounter.type,
    monitoradosEncontro: [first.id, second.id],
    timestamp: encounter.timestamp,
    posicoes: {
      [first.id]: { lat: first.latitude, lon: first.longitude },
      [second.id]: { lat: second.latitude, lon: second.longitude },
    },
    distanciaMetros: encounter.distanceMeters,
  };
}
