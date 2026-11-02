import { DatasetError } from "./dataset-error.js";
import type { LocationRecord } from "./types.js";

export const FIELD_NAMES = [
  "idMonitorado",
  "faccaoMonitorado",
  "timestamp",
  "latitude",
  "longitude",
  "medidaProtetiva",
  "idsRestricaoMedida",
] as const;

export const HEADER = FIELD_NAMES.join(";");

const INTEGER = /^[0-9]+$/;
const DECIMAL = /^[-+]?[0-9]+(\.[0-9]+)?$/;
const TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/;

/** Thrown by the field parsers; `parseRecord` adds the line and source. */
class FieldError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(reason);
  }
}

function parseInteger(value: string, field: string): number {
  if (!INTEGER.test(value)) {
    throw new FieldError(field, `${JSON.stringify(value)} is not a non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new FieldError(field, `${JSON.stringify(value)} is not a safe integer`);
  }
  return parsed;
}

function parseFaction(value: string): number | null {
  return value === "" ? null : parseInteger(value, "faccaoMonitorado");
}

function parseCoordinate(value: string, field: string, limit: number): number {
  if (!DECIMAL.test(value)) {
    throw new FieldError(field, `${JSON.stringify(value)} is not a decimal number`);
  }
  const parsed = Number(value);
  if (parsed < -limit || parsed > limit) {
    throw new FieldError(field, `${JSON.stringify(value)} is outside [-${limit}, ${limit}]`);
  }
  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new FieldError("medidaProtetiva", `${JSON.stringify(value)} is not "true" or "false"`);
}

/** Removes one pair of delimiting double quotes, if present. */
function unquote(value: string, field: string): string {
  const starts = value.startsWith('"');
  const ends = value.length > 1 && value.endsWith('"');
  if (starts !== ends) {
    throw new FieldError(field, `${JSON.stringify(value)} has unbalanced quotes`);
  }
  return starts ? value.slice(1, -1) : value;
}

function parseTimestamp(value: string): string {
  const timestamp = unquote(value, "timestamp");
  if (!TIMESTAMP.test(timestamp)) {
    throw new FieldError("timestamp", `${JSON.stringify(value)} is not in the format "YYYY-MM-DD HH:MM:SS"`);
  }
  return timestamp;
}

function parseRestrictedIds(value: string): number[] {
  if (value === "") return [];
  const list = unquote(value, "idsRestricaoMedida");
  return list.split(",").map((id) => parseInteger(id, "idsRestricaoMedida"));
}

/**
 * Converts one data line into a record. Throws `DatasetError` with the line,
 * field and source when the line cannot be converted.
 */
export function parseRecord(line: string, lineNumber: number, source?: string): LocationRecord {
  const fields = line.split(";");
  if (fields.length !== FIELD_NAMES.length) {
    throw new DatasetError(`expected ${FIELD_NAMES.length} fields separated by ";", found ${fields.length}`, {
      source,
      lineNumber,
    });
  }
  const [id, faction, timestamp, latitude, longitude, protectiveMeasure, restrictedIds] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  try {
    return {
      id: parseInteger(id, "idMonitorado"),
      faction: parseFaction(faction),
      timestamp: parseTimestamp(timestamp),
      latitude: parseCoordinate(latitude, "latitude", 90),
      longitude: parseCoordinate(longitude, "longitude", 180),
      hasProtectiveMeasure: parseBoolean(protectiveMeasure),
      restrictedIds: parseRestrictedIds(restrictedIds),
    };
  } catch (error) {
    if (error instanceof FieldError) {
      throw new DatasetError(error.reason, { source, lineNumber, field: error.field });
    }
    throw error;
  }
}
