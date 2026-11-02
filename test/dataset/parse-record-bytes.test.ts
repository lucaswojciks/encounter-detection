import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseRecord } from "../../src/dataset/parse-record.js";
import { RecordBytesParser } from "../../src/dataset/parse-record-bytes.js";
import type { LocationRecord } from "../../src/dataset/types.js";

function fast(line: string, parser = new RecordBytesParser()): LocationRecord | undefined {
  const bytes = Buffer.from(line, "utf8");
  return parser.parse(bytes, 0, bytes.length);
}

/** `parseRecord` result, or `undefined` when it rejects the line. */
function reference(line: string): LocationRecord | undefined {
  try {
    return parseRecord(line, 2);
  } catch {
    return undefined;
  }
}

/** Deterministic pseudo-random generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("RecordBytesParser accepted lines", () => {
  const accepted = [
    '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;',
    '2;1;"2024-01-01 00:00:00";-21.15463;-61.43519;true;"1,3"',
    '17;3;"2024-01-01 00:00:05";-44.63520;-60.00000;true;"10"',
    "17;3;2024-01-01 00:00:05;-44.6352;-60;true;10,11,12",
    '0;0;"0000-00-00 00:00:00";0;0;false;',
    '007;010;"2024-12-31 23:59:59";+5.25;-0.0;false;"007"',
    '1;;"2024-01-01 00:00:00";-0;+0;false;',
    '1;;"2024-01-01 00:00:00";90;-180;false;',
    '1;;"2024-01-01 00:00:00";-90.000000000000;180.0;false;',
    '999999999999999;999999999999999;"2024-01-01 00:00:00";1.23456789012345;123.456789012345;false;',
    '1;;"2024-01-01 00:00:00";0.00000000000001;-0.0000000000001;true;"999999999999999,0"',
  ];

  test("returns exactly the record of parseRecord", () => {
    for (const line of accepted) {
      assert.ok(reference(line) !== undefined, `parseRecord rejects ${line}`);
      const record = fast(line);
      assert.ok(record !== undefined, line);
      assert.deepStrictEqual(record, parseRecord(line, 2), line);
      assert.ok(Object.is(record.latitude, parseRecord(line, 2).latitude), `sign of zero in ${line}`);
      assert.ok(Object.is(record.longitude, parseRecord(line, 2).longitude), `sign of zero in ${line}`);
    }
  });

  test("returns a new restriction list for each record", () => {
    const parser = new RecordBytesParser();
    const line = '1;;"2024-01-01 00:00:00";0;0;false;';
    assert.notEqual(fast(line, parser)?.restrictedIds, fast(line, parser)?.restrictedIds);
  });

  test("reads only the given range of the buffer", () => {
    const line = '2;1;"2024-01-01 00:00:00";-21.15463;-61.43519;true;"1,3"';
    const bytes = Buffer.from(`xx;${line}\r\nyy`, "utf8");
    assert.deepStrictEqual(new RecordBytesParser().parse(bytes, 3, 3 + line.length), parseRecord(line, 2));
  });

  test("keeps the right timestamp when timestamps change and when a line is deferred", () => {
    const parser = new RecordBytesParser();
    const lines = [
      '1;;"2024-01-01 00:00:00";0;0;false;',
      '1;;"2024-01-01 00:00:05";0;0;false;',
      '1;;"2024-01-01 00:00:0x";0;0;false;',
      '1;;"2024-01-01 00:00:05";0;0;false;',
      "1;;2024-01-01 00:00:00;0;0;false;",
      '1;;"2024-01-01 00:00:05";0;0;fals;',
      '1;;"2024-01-01 00:00:10";0;0;false;',
    ];
    assert.deepEqual(
      lines.map((line) => fast(line, parser)?.timestamp),
      ["2024-01-01 00:00:00", "2024-01-01 00:00:05", undefined, "2024-01-01 00:00:05", "2024-01-01 00:00:00", undefined, "2024-01-01 00:00:10"],
    );
  });
});

describe("RecordBytesParser deferred lines", () => {
  test("defers to parseRecord every line outside the canonical format", () => {
    const deferred = [
      "",
      ";",
      '1;;"2024-01-01 00:00:00";0;0;false',
      '1;;"2024-01-01 00:00:00";0;0;false;;',
      '1;;"2024-01-01 00:00:00";0;0;false;;extra',
      '1234567890123456;;"2024-01-01 00:00:00";0;0;false;',
      '-1;;"2024-01-01 00:00:00";0;0;false;',
      '1;-1;"2024-01-01 00:00:00";0;0;false;',
      '1;x;"2024-01-01 00:00:00";0;0;false;',
      ' 1;;"2024-01-01 00:00:00";0;0;false;',
      '1;;"2024-01-01 00:00:00";0;0;false; ',
      '1;;"2024-01-01 00:00:00;0;0;false;',
      '1;;2024-01-01 00:00:00";0;0;false;',
      '1;;"2024-1-01 00:00:00";0;0;false;',
      '1;;"2024-01-01T00:00:00";0;0;false;',
      '1;;"2024-01-01 00:00:00 ";0;0;false;',
      '1;;"";0;0;false;',
      '1;;"2024-01-01 00:00:00";90.0000000000001;0;false;',
      '1;;"2024-01-01 00:00:00";-90.1;0;false;',
      '1;;"2024-01-01 00:00:00";0;180.5;false;',
      '1;;"2024-01-01 00:00:00";12.3456789012345678;0;false;',
      '1;;"2024-01-01 00:00:00";0.1234567890123456;0;false;',
      '1;;"2024-01-01 00:00:00";5.;0;false;',
      '1;;"2024-01-01 00:00:00";.5;0;false;',
      '1;;"2024-01-01 00:00:00";-;0;false;',
      '1;;"2024-01-01 00:00:00";+-1;0;false;',
      '1;;"2024-01-01 00:00:00";1e5;0;false;',
      '1;;"2024-01-01 00:00:00";1,5;0;false;',
      '1;;"2024-01-01 00:00:00";;0;false;',
      '1;;"2024-01-01 00:00:00";0;0;yes;',
      '1;;"2024-01-01 00:00:00";0;0;TRUE;',
      '1;;"2024-01-01 00:00:00";0;0;;',
      '1;;"2024-01-01 00:00:00";0;0;true;"1,3',
      '1;;"2024-01-01 00:00:00";0;0;true;1,3"',
      '1;;"2024-01-01 00:00:00";0;0;true;""',
      '1;;"2024-01-01 00:00:00";0;0;true;"',
      '1;;"2024-01-01 00:00:00";0;0;true;"1,,3"',
      '1;;"2024-01-01 00:00:00";0;0;true;"1,"',
      '1;;"2024-01-01 00:00:00";0;0;true;",1"',
      '1;;"2024-01-01 00:00:00";0;0;true;"1, 3"',
      '1;;"2024-01-01 00:00:00";0;0;true;"1234567890123456"',
      '1;;"2024-01-01 00:00:00";0;0;true;"1\r3"',
      '1;;"2024-01-01 00:00:00";0;0;false;\r',
      '1;;"2024-01-01 00:00:00";0;0;false\r;',
      '1;;"2024-01-01 00:00:00";-25.5;-73.9;falsé;',
      '1;;"2024-01-01 00:00:00";-25.5;-73.9;false;"1٣"',
    ];
    for (const line of deferred) assert.equal(fast(line), undefined, JSON.stringify(line));
  });

  test("includes valid lines that parseRecord accepts but the fast path does not", () => {
    for (const line of [
      '1234567890123456;;"2024-01-01 00:00:00";0;0;false;',
      '1;;"2024-01-01 00:00:00";12.3456789012345678;0;false;',
      '1;;"2024-01-01 00:00:00";0;0;true;"1234567890123456"',
    ]) {
      assert.equal(fast(line), undefined);
      assert.ok(reference(line) !== undefined, line);
    }
  });
});

describe("RecordBytesParser on random lines", () => {
  function digits(rng: () => number, count: number): string {
    let text = "";
    for (let k = 0; k < count; k++) text += String(Math.floor(rng() * 10));
    return text;
  }

  function decimal(rng: () => number): string {
    const sign = ["", "", "-", "+"][Math.floor(rng() * 4)] as string;
    const integer = digits(rng, 1 + Math.floor(rng() * 4));
    const decimals = rng() < 0.15 ? "" : `.${digits(rng, 1 + Math.floor(rng() * 13))}`;
    return `${sign}${integer}${decimals}`;
  }

  test("coordinates are bit-for-bit equal to Number() on 200 000 random decimals", () => {
    const rng = random(42);
    const parser = new RecordBytesParser();
    let compared = 0;
    for (let k = 0; k < 200_000; k++) {
      const latitude = decimal(rng);
      const longitude = decimal(rng);
      const line = `1;;"2024-01-01 00:00:00";${latitude};${longitude};false;`;
      const record = fast(line, parser);
      const expected = reference(line);
      if (record === undefined) continue;
      compared++;
      assert.ok(expected !== undefined, line);
      assert.ok(Object.is(record.latitude, Number(latitude)), line);
      assert.ok(Object.is(record.longitude, Number(longitude)), line);
    }
    assert.ok(compared > 50_000, `only ${compared} lines took the fast path`);
  });

  test("never returns a record different from parseRecord on mutated lines", () => {
    const rng = random(7);
    const parser = new RecordBytesParser();
    const alphabet = '0123456789;,."-+ :\rtruefalsé';
    let accepted = 0;
    let deferred = 0;
    for (let k = 0; k < 100_000; k++) {
      const ids = Array.from({ length: Math.floor(rng() * 4) }, () => digits(rng, 1 + Math.floor(rng() * 16)));
      const restricted = ids.length === 0 ? "" : rng() < 0.5 ? `"${ids.join(",")}"` : ids.join(",");
      const fields = [
        digits(rng, 1 + Math.floor(rng() * 16)),
        rng() < 0.5 ? "" : digits(rng, 1 + Math.floor(rng() * 3)),
        `"2024-01-0${1 + Math.floor(rng() * 9)} 00:00:${digits(rng, 2)}"`,
        decimal(rng),
        decimal(rng),
        rng() < 0.5 ? "true" : "false",
        restricted,
      ];
      let line = fields.join(";");
      const mutations = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * 3);
      for (let m = 0; m < mutations; m++) {
        const at = Math.floor(rng() * (line.length + 1));
        const char = alphabet[Math.floor(rng() * alphabet.length)] as string;
        const kind = rng();
        line =
          kind < 0.4
            ? line.slice(0, at) + char + line.slice(at)
            : kind < 0.7
              ? line.slice(0, at) + line.slice(at + 1)
              : line.slice(0, at) + char + line.slice(at + 1);
      }
      const record = fast(line, parser);
      if (record === undefined) {
        deferred++;
        continue;
      }
      accepted++;
      assert.deepStrictEqual(record, parseRecord(line, 2), JSON.stringify(line));
    }
    assert.ok(accepted > 10_000 && deferred > 10_000, `accepted ${accepted}, deferred ${deferred}`);
  });
});
