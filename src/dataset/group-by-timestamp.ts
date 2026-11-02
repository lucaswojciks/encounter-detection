import { DatasetError } from "./dataset-error.js";
import { HEADER, parseRecord } from "./parse-record.js";
import type { LocationRecord, TimestampGroup } from "./types.js";

const BOM = String.fromCharCode(0xfeff);

/**
 * Line-by-line state of the grouping: line number, header check and the group
 * being filled. Each call returns the group that the line completed, if any.
 * Shared by `groupByTimestamp` (text lines) and the byte reader of
 * `readDataset`, which hands over records it has already converted.
 *
 * Records must be in chronological order: a timestamp lower than the previous
 * group's is an error, because groups must be contiguous to be streamed.
 */
export class TimestampGrouper {
  /** Number of the last line received (header = line 1). */
  lineNumber = 0;
  private timestamp: string | undefined;
  private records: LocationRecord[] = [];

  constructor(private readonly source?: string) {}

  /** Receives the next text line, without its line terminator. */
  addLine(line: string): TimestampGroup | undefined {
    this.lineNumber++;
    if (line.endsWith("\r")) line = line.slice(0, -1);

    if (this.lineNumber === 1) {
      if (line.startsWith(BOM)) line = line.slice(BOM.length);
      if (line !== HEADER) {
        throw new DatasetError(`expected header ${JSON.stringify(HEADER)}, found ${JSON.stringify(line)}`, {
          source: this.source,
          lineNumber: this.lineNumber,
        });
      }
      return undefined;
    }
    if (line === "") return undefined;
    return this.add(parseRecord(line, this.lineNumber, this.source));
  }

  /**
   * Receives the next line as a record already converted with the rules of
   * `parseRecord`. Only valid after the header line.
   */
  addRecord(record: LocationRecord): TimestampGroup | undefined {
    this.lineNumber++;
    return this.add(record);
  }

  /** Ends the input and returns the last group, if any. */
  finish(): TimestampGroup | undefined {
    if (this.lineNumber === 0) {
      throw new DatasetError("empty input: missing header", { source: this.source });
    }
    if (this.timestamp === undefined) return undefined;
    const group = { timestamp: this.timestamp, records: this.records };
    this.timestamp = undefined;
    this.records = [];
    return group;
  }

  private add(record: LocationRecord): TimestampGroup | undefined {
    if (record.timestamp === this.timestamp) {
      this.records.push(record);
      return undefined;
    }
    let completed: TimestampGroup | undefined;
    if (this.timestamp !== undefined) {
      if (record.timestamp < this.timestamp) {
        throw new DatasetError(
          `timestamp "${record.timestamp}" is earlier than the previous timestamp "${this.timestamp}"; ` +
            "records must be in chronological order",
          { source: this.source, lineNumber: this.lineNumber, field: "timestamp" },
        );
      }
      completed = { timestamp: this.timestamp, records: this.records };
    }
    this.timestamp = record.timestamp;
    this.records = [record];
    return completed;
  }
}

/**
 * Validates the header and yields consecutive records that share exactly the
 * same timestamp as one group, in input order. Lines are consumed only as the
 * caller requests groups, so memory is bounded by the largest group.
 */
export async function* groupByTimestamp(
  lines: Iterable<string> | AsyncIterable<string>,
  source?: string,
): AsyncGenerator<TimestampGroup, void, undefined> {
  const grouper = new TimestampGrouper(source);
  for await (const line of lines) {
    const group = grouper.addLine(line);
    if (group !== undefined) yield group;
  }
  const last = grouper.finish();
  if (last !== undefined) yield last;
}
