import type { LocationRecord } from "./types.js";

const QUOTE = 0x22;
const PLUS = 0x2b;
const COMMA = 0x2c;
const MINUS = 0x2d;
const DOT = 0x2e;
const ZERO = 0x30;
const COLON = 0x3a;
const SEMICOLON = 0x3b;
const SPACE = 0x20;

/** Integers with up to 15 digits are below 2^53, so every one is exact in a double. */
const MAX_DIGITS = 15;
const POWERS_OF_TEN = Array.from({ length: MAX_DIGITS + 1 }, (_, k) => 10 ** k);

/** `YYYY-MM-DD HH:MM:SS`, with 0 marking the digit positions. */
const TIMESTAMP_TEMPLATE = [0, 0, 0, 0, MINUS, 0, 0, MINUS, 0, 0, SPACE, 0, 0, COLON, 0, 0, COLON, 0, 0];
const TIMESTAMP_LENGTH = TIMESTAMP_TEMPLATE.length;
const TRUE = [0x74, 0x72, 0x75, 0x65];
const FALSE = [0x66, 0x61, 0x6c, 0x73, 0x65];

function isDigit(byte: number): boolean {
  return byte >= ZERO && byte <= ZERO + 9;
}

/**
 * Fast path of the record conversion, reading the bytes of one line directly
 * (spec 001, section 12). It accepts only a canonical subset of the format of
 * `parseRecord` and returns exactly the record `parseRecord` would return for
 * the same line. For anything outside that subset, including every invalid
 * line, it returns `undefined`, and the caller converts the line with
 * `parseRecord`, which keeps the validation rules and error messages in one
 * place.
 *
 * The subset: integers with 1 to 15 digits; coordinates with an optional sign,
 * at least one digit before and, when there is a point, after it, 15 digits in
 * total and inside the range of the field; the timestamp with or without
 * quotes; the restriction list empty or with ids of 1 to 15 digits, with or
 * without quotes. Only ASCII bytes are accepted.
 *
 * Coordinates are converted as m / 10^k, with m the integer formed by their
 * digits and k the number of decimals. Both operands are exact doubles and
 * IEEE 754 division is correctly rounded, so the result is the double nearest
 * to the decimal value: the same that `Number()` returns.
 *
 * Not reentrant: one instance per reader. It reuses the timestamp string while
 * the timestamp bytes repeat, which is the common case within a group.
 */
export class RecordBytesParser {
  private bytes: Uint8Array = new Uint8Array(0);
  private position = 0;
  private end = 0;
  private readonly timestampBytes = new Uint8Array(TIMESTAMP_LENGTH);
  private timestampText: string | undefined;

  /** Converts the line in `bytes[start, end)`, or returns `undefined` to defer it to `parseRecord`. */
  parse(bytes: Uint8Array, start: number, end: number): LocationRecord | undefined {
    this.bytes = bytes;
    this.position = start;
    this.end = end;

    const id = this.integer();
    if (id < 0 || !this.skip(SEMICOLON)) return undefined;
    let faction: number | null = null;
    if (this.peek() !== SEMICOLON) {
      faction = this.integer();
      if (faction < 0) return undefined;
    }
    if (!this.skip(SEMICOLON)) return undefined;
    const timestamp = this.timestamp();
    if (timestamp === undefined || !this.skip(SEMICOLON)) return undefined;
    const latitude = this.coordinate(90);
    if (Number.isNaN(latitude) || !this.skip(SEMICOLON)) return undefined;
    const longitude = this.coordinate(180);
    if (Number.isNaN(longitude) || !this.skip(SEMICOLON)) return undefined;
    let hasProtectiveMeasure: boolean;
    if (this.word(TRUE)) hasProtectiveMeasure = true;
    else if (this.word(FALSE)) hasProtectiveMeasure = false;
    else return undefined;
    if (!this.skip(SEMICOLON)) return undefined;
    const restrictedIds = this.idList();
    if (restrictedIds === undefined || this.position !== this.end) return undefined;

    return { id, faction, timestamp, latitude, longitude, hasProtectiveMeasure, restrictedIds };
  }

  private peek(): number {
    return this.position < this.end ? (this.bytes[this.position] as number) : -1;
  }

  private skip(byte: number): boolean {
    if (this.peek() !== byte) return false;
    this.position++;
    return true;
  }

  private word(expected: readonly number[]): boolean {
    if (this.end - this.position < expected.length) return false;
    for (let k = 0; k < expected.length; k++) {
      if (this.bytes[this.position + k] !== expected[k]) return false;
    }
    this.position += expected.length;
    return true;
  }

  /** Non-negative integer with 1 to 15 digits, or -1. */
  private integer(): number {
    let value = 0;
    let digits = 0;
    while (isDigit(this.peek())) {
      if (++digits > MAX_DIGITS) return -1;
      value = value * 10 + ((this.bytes[this.position++] as number) - ZERO);
    }
    return digits === 0 ? -1 : value;
  }

  /** Decimal number within [-limit, limit], or NaN. */
  private coordinate(limit: number): number {
    const negative = this.peek() === MINUS;
    if (negative || this.peek() === PLUS) this.position++;
    let mantissa = 0;
    let digits = 0;
    while (isDigit(this.peek())) {
      if (++digits > MAX_DIGITS) return Number.NaN;
      mantissa = mantissa * 10 + ((this.bytes[this.position++] as number) - ZERO);
    }
    if (digits === 0) return Number.NaN;
    let decimals = 0;
    if (this.skip(DOT)) {
      while (isDigit(this.peek())) {
        if (++digits > MAX_DIGITS) return Number.NaN;
        mantissa = mantissa * 10 + ((this.bytes[this.position++] as number) - ZERO);
        decimals++;
      }
      if (decimals === 0) return Number.NaN;
    }
    const magnitude = mantissa / (POWERS_OF_TEN[decimals] as number);
    const value = negative ? -magnitude : magnitude;
    return value < -limit || value > limit ? Number.NaN : value;
  }

  private timestamp(): string | undefined {
    const quoted = this.skip(QUOTE);
    const start = this.position;
    if (this.end - start < TIMESTAMP_LENGTH) return undefined;
    // The bytes of the last timestamp were already validated; equal bytes need no check.
    let repeated = this.timestampText !== undefined;
    for (let k = 0; repeated && k < TIMESTAMP_LENGTH; k++) {
      if (this.bytes[start + k] !== this.timestampBytes[k]) repeated = false;
    }
    if (!repeated) {
      for (let k = 0; k < TIMESTAMP_LENGTH; k++) {
        const byte = this.bytes[start + k] as number;
        const expected = TIMESTAMP_TEMPLATE[k] as number;
        if (expected === 0 ? !isDigit(byte) : byte !== expected) return undefined;
      }
    }
    this.position += TIMESTAMP_LENGTH;
    if (quoted && !this.skip(QUOTE)) return undefined;

    if (!repeated) {
      this.timestampBytes.set(this.bytes.subarray(start, start + TIMESTAMP_LENGTH));
      this.timestampText = String.fromCharCode(...this.timestampBytes);
    }
    return this.timestampText;
  }

  /** Empty field, or ids of 1 to 15 digits separated by commas, optionally quoted; `undefined` otherwise. */
  private idList(): number[] | undefined {
    if (this.position === this.end) return [];
    const quoted = this.skip(QUOTE);
    const ids: number[] = [];
    do {
      const id = this.integer();
      if (id < 0) return undefined;
      ids.push(id);
    } while (this.skip(COMMA));
    if (quoted && !this.skip(QUOTE)) return undefined;
    return ids;
  }
}
