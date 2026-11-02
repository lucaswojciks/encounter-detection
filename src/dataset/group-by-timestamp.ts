import { DatasetError } from "./dataset-error.js";
import { HEADER, parseRecord } from "./parse-record.js";
import type { LocationRecord, TimestampGroup } from "./types.js";

const BOM = "﻿";

/**
 * Validates the header and yields consecutive records that share exactly the
 * same timestamp as one group, in input order. Lines are consumed only as the
 * caller requests groups, so memory is bounded by the largest group.
 *
 * Records must be in chronological order: a timestamp lower than the previous
 * group's is an error, because groups must be contiguous to be streamed.
 */
export async function* groupByTimestamp(
  lines: Iterable<string> | AsyncIterable<string>,
  source?: string,
): AsyncGenerator<TimestampGroup, void, undefined> {
  let lineNumber = 0;
  let timestamp: string | undefined;
  let records: LocationRecord[] = [];

  for await (let line of lines) {
    lineNumber++;
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (lineNumber === 1) {
      if (line.startsWith(BOM)) line = line.slice(BOM.length);
      if (line !== HEADER) {
        throw new DatasetError(`expected header ${JSON.stringify(HEADER)}, found ${JSON.stringify(line)}`, {
          source,
          lineNumber,
        });
      }
      continue;
    }
    if (line === "") continue;

    const record = parseRecord(line, lineNumber, source);
    if (record.timestamp === timestamp) {
      records.push(record);
      continue;
    }
    if (timestamp !== undefined) {
      if (record.timestamp < timestamp) {
        throw new DatasetError(
          `timestamp "${record.timestamp}" is earlier than the previous timestamp "${timestamp}"; ` +
            "records must be in chronological order",
          { source, lineNumber, field: "timestamp" },
        );
      }
      yield { timestamp, records };
    }
    timestamp = record.timestamp;
    records = [record];
  }

  if (lineNumber === 0) {
    throw new DatasetError("empty input: missing header", { source });
  }
  if (timestamp !== undefined) {
    yield { timestamp, records };
  }
}
