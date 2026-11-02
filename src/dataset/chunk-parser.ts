import { TimestampGrouper } from "./group-by-timestamp.js";
import { RecordBytesParser } from "./parse-record-bytes.js";
import type { LocationRecord, TimestampGroup } from "./types.js";

const LF = 0x0a;
const CR = 0x0d;

/**
 * Splits the bytes of a dataset into lines and groups their records, chunk by
 * chunk, with the same result as reading the text with `readline` and
 * `groupByTimestamp` (spec 001, section 12): the same groups, records, line
 * numbers and errors.
 *
 * - Lines end at LF, CRLF or a CR alone, as in `readline`; a line split
 *   between chunks is joined before it is converted.
 * - Data lines are converted by `RecordBytesParser`. Any other line (the
 *   header, empty lines, lines with a CR alone or outside the canonical
 *   format) is decoded as UTF-8 and handed to `TimestampGrouper.addLine`,
 *   that is, to `parseRecord`.
 *
 * The groups completed by a chunk are yielded before the next chunk is read,
 * and an error ends the iteration at the line where it was found.
 */
export class DatasetChunkParser {
  private readonly grouper: TimestampGrouper;
  private readonly records = new RecordBytesParser();
  /** Bytes of a line that started in an earlier chunk and has not ended yet. */
  private pending: Uint8Array | undefined;

  constructor(source?: string) {
    this.grouper = new TimestampGrouper(source);
  }

  *push(chunk: Uint8Array): Generator<TimestampGroup, void, undefined> {
    let start = 0;
    if (this.pending !== undefined) {
      const lineEnd = chunk.indexOf(LF);
      if (lineEnd === -1) {
        this.pending = concat(this.pending, chunk);
        return;
      }
      const line = concat(this.pending, chunk.subarray(0, lineEnd));
      this.pending = undefined;
      yield* this.line(line, 0, line.length);
      start = lineEnd + 1;
    }
    for (let lineEnd = chunk.indexOf(LF, start); lineEnd !== -1; lineEnd = chunk.indexOf(LF, start)) {
      // `line` inlined: this loop runs once per line, and `yield*` would create a generator for each.
      const record = this.record(chunk, start, lineEnd);
      if (record === undefined) yield* this.textLine(chunk, start, lineEnd);
      else {
        const group = this.grouper.addRecord(record);
        if (group !== undefined) yield group;
      }
      start = lineEnd + 1;
    }
    // A copy: the caller may reuse the memory of the chunk (readDataset does).
    if (start < chunk.length) this.pending = new Uint8Array(chunk.subarray(start));
  }

  /** Ends the input: converts a last line without a terminator and yields the last group. */
  *end(): Generator<TimestampGroup, void, undefined> {
    if (this.pending !== undefined) {
      const line = this.pending;
      this.pending = undefined;
      yield* this.line(line, 0, line.length);
    }
    const last = this.grouper.finish();
    if (last !== undefined) yield last;
  }

  /** One line ended by LF or by the end of the input, in `bytes[start, end)`. */
  private *line(bytes: Uint8Array, start: number, end: number): Generator<TimestampGroup, void, undefined> {
    const record = this.record(bytes, start, end);
    if (record === undefined) {
      yield* this.textLine(bytes, start, end);
      return;
    }
    const group = this.grouper.addRecord(record);
    if (group !== undefined) yield group;
  }

  /**
   * Fast path for the line in `bytes[start, end)`, ended by LF or by the end of
   * the input: its record, or `undefined` when the line must go to `textLine`.
   */
  private record(bytes: Uint8Array, start: number, end: number): LocationRecord | undefined {
    if (this.grouper.lineNumber === 0) return undefined; // the header
    const contentEnd = end > start && bytes[end - 1] === CR ? end - 1 : end;
    return this.records.parse(bytes, start, contentEnd);
  }

  /** Slow path: the line as text, through `TimestampGrouper.addLine` and `parseRecord`. */
  private *textLine(bytes: Uint8Array, start: number, end: number): Generator<TimestampGroup, void, undefined> {
    // A CR before the LF (or the end) belongs to the terminator; any other CR ends a line.
    const text = Buffer.from(bytes.buffer, bytes.byteOffset + start, end - start).toString("utf8");
    const lines = text.split("\r");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      const group = this.grouper.addLine(line);
      if (group !== undefined) yield group;
    }
  }
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const joined = new Uint8Array(first.length + second.length);
  joined.set(first);
  joined.set(second, first.length);
  return joined;
}
