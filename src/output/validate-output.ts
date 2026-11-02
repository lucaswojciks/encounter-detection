import type { LocationRecord } from "../dataset/types.js";
import { classifyEncounter } from "../encounters/classify.js";
import { ENCOUNTER_DISTANCE_METERS } from "../encounters/detect.js";
import { haversineDistance } from "../encounters/haversine.js";
import type { EncounterType } from "../encounters/types.js";

const KEYS = ["tipo", "monitoradosEncontro", "timestamp", "posicoes", "distanciaMetros"];
const TYPES: readonly string[] = ["generico", "faccao", "protetiva"] satisfies EncounterType[];
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;
const MAX_REPORTED_ERRORS = 20;

/** Records of the dataset at one timestamp, by id (first record of a repeated id). */
export type DatasetLookup = (timestamp: string) => ReadonlyMap<number, LocationRecord> | undefined;

export interface OutputValidation {
  readonly encounters: number;
  readonly byType: Readonly<Record<EncounterType, number>>;
  /** Total number of violations; only the first ones are listed in `errors`. */
  readonly errorCount: number;
  readonly errors: readonly string[];
}

/**
 * Checks an output document against the output rules (spec 004, VAL-02)
 * without using any pair search strategy. With `dataset`, it also checks each
 * encounter's positions and type against the dataset records.
 */
export function validateOutput(document: unknown, dataset?: DatasetLookup): OutputValidation {
  const errors: string[] = [];
  let errorCount = 0;
  const fail = (message: string) => {
    errorCount++;
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message);
  };
  const byType: Record<EncounterType, number> = { generico: 0, faccao: 0, protetiva: 0 };

  if (!Array.isArray(document)) {
    fail("output is not a JSON array");
    return { encounters: 0, byType, errorCount, errors };
  }

  const seen = new Set<string>();
  let previous: [string, number, number] | undefined;
  document.forEach((item: unknown, index) => {
    const at = `encounter ${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) return fail(`${at}: not an object`);
    const encounter = item as Record<string, unknown>;
    if (Object.keys(encounter).join(",") !== KEYS.join(",")) {
      return fail(`${at}: keys ${JSON.stringify(Object.keys(encounter))}, expected ${JSON.stringify(KEYS)}`);
    }

    const { tipo, monitoradosEncontro: ids, timestamp, posicoes, distanciaMetros: distance } = encounter;
    if (typeof tipo !== "string" || !TYPES.includes(tipo)) return fail(`${at}: invalid tipo ${JSON.stringify(tipo)}`);
    if (
      !Array.isArray(ids) ||
      ids.length !== 2 ||
      !ids.every((id) => Number.isSafeInteger(id) && id >= 0) ||
      !(ids[0] < ids[1])
    ) {
      return fail(`${at}: monitoradosEncontro must be two ascending integer ids, found ${JSON.stringify(ids)}`);
    }
    const [firstId, secondId] = ids as [number, number];
    if (typeof timestamp !== "string" || !TIMESTAMP.test(timestamp)) {
      return fail(`${at}: invalid timestamp ${JSON.stringify(timestamp)}`);
    }
    const positions = validPositions(posicoes, firstId, secondId);
    if (positions === undefined) return fail(`${at}: posicoes must hold lat/lon numbers for ids ${firstId} and ${secondId}`);
    if (typeof distance !== "number" || !(distance < ENCOUNTER_DISTANCE_METERS)) {
      return fail(`${at}: distanciaMetros ${JSON.stringify(distance)} is not a number below ${ENCOUNTER_DISTANCE_METERS}`);
    }
    const [first, second] = positions;
    const recomputed = haversineDistance(first.lat, first.lon, second.lat, second.lon);
    if (!Object.is(recomputed, distance)) fail(`${at}: distanciaMetros ${distance} differs from recomputed ${recomputed}`);

    const key = `${timestamp} ${firstId}-${secondId}`;
    if (seen.has(key)) fail(`${at}: pair ${firstId}-${secondId} repeated at ${timestamp}`);
    seen.add(key);
    const current: [string, number, number] = [timestamp, firstId, secondId];
    if (previous !== undefined && compareOrder(previous, current) > 0) {
      fail(`${at}: out of order after ${previous[0]} ${previous[1]}-${previous[2]}`);
    }
    previous = current;
    byType[tipo as EncounterType]++;

    if (dataset !== undefined) {
      const records = dataset(timestamp);
      const a = records?.get(firstId);
      const b = records?.get(secondId);
      if (a === undefined || b === undefined) return fail(`${at}: ids ${firstId}-${secondId} not in dataset at ${timestamp}`);
      if (a.latitude !== first.lat || a.longitude !== first.lon || b.latitude !== second.lat || b.longitude !== second.lon) {
        fail(`${at}: posicoes differ from the dataset records at ${timestamp}`);
      }
      const expectedType = classifyEncounter(a, b);
      if (expectedType !== tipo) fail(`${at}: tipo ${tipo}, but the dataset attributes give ${expectedType}`);
    }
  });

  return { encounters: document.length, byType, errorCount, errors };
}

interface Position {
  readonly lat: number;
  readonly lon: number;
}

function validPositions(value: unknown, firstId: number, secondId: number): [Position, Position] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const positions = value as Record<string, unknown>;
  if (Object.keys(positions).join(",") !== `${firstId},${secondId}`) return undefined;
  const first = positions[firstId];
  const second = positions[secondId];
  return isPosition(first) && isPosition(second) ? [first, second] : undefined;
}

function isPosition(value: unknown): value is Position {
  if (typeof value !== "object" || value === null) return false;
  const { lat, lon } = value as Record<string, unknown>;
  return (
    Object.keys(value).join(",") === "lat,lon" &&
    typeof lat === "number" &&
    typeof lon === "number" &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

function compareOrder(a: readonly [string, number, number], b: readonly [string, number, number]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] - b[1] || a[2] - b[2];
}
