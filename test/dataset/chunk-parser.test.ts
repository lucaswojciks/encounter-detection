import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { describe, test } from "node:test";

import { DatasetChunkParser } from "../../src/dataset/chunk-parser.js";
import { DatasetError } from "../../src/dataset/dataset-error.js";
import { groupByTimestamp } from "../../src/dataset/group-by-timestamp.js";
import { HEADER } from "../../src/dataset/parse-record.js";
import type { TimestampGroup } from "../../src/dataset/types.js";

const SOURCE = "input.txt";
const BOM = String.fromCharCode(0xfeff);
const T1 = "2024-01-01 00:00:00";
const T2 = "2024-01-01 00:00:05";
const T3 = "2024-01-01 00:00:10";

function row(id: number, timestamp: string, extra = ""): string {
  return `${id};${id % 3 === 0 ? "" : id % 3};"${timestamp}";-25.5${id};-73.9${id};${id % 2 === 0};${extra}`;
}

interface Outcome {
  groups: TimestampGroup[];
  error?: { name: string; message: string; lineNumber: number | undefined; field: string | undefined };
}

async function outcome(groups: AsyncIterable<TimestampGroup> | Iterable<TimestampGroup>): Promise<Outcome> {
  const result: Outcome = { groups: [] };
  try {
    for await (const group of groups) result.groups.push(group);
  } catch (error) {
    assert.ok(error instanceof DatasetError, String(error));
    result.error = { name: error.name, message: error.message, lineNumber: error.lineNumber, field: error.field };
  }
  return result;
}

/** The previous reader: text decoded by a stream, lines split by `readline`. */
function referenceGroups(bytes: Buffer): AsyncIterable<TimestampGroup> {
  const lines = createInterface({ input: Readable.from([bytes]), crlfDelay: Infinity });
  return groupByTimestamp(lines, SOURCE);
}

/** The byte reader, fed with chunks of `chunkSize` bytes. */
function* chunkedGroups(bytes: Buffer, chunkSize: number): Generator<TimestampGroup, void, undefined> {
  const parser = new DatasetChunkParser(SOURCE);
  for (let start = 0; start < bytes.length; start += chunkSize) {
    yield* parser.push(bytes.subarray(start, start + chunkSize));
  }
  yield* parser.end();
}

async function assertSameAsReference(content: string | Buffer, label: string): Promise<Outcome> {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const expected = await outcome(referenceGroups(bytes));
  // Every chunk size up to the whole input, so every byte is a chunk border in some run.
  for (let chunkSize = 1; chunkSize <= Math.max(1, bytes.length); chunkSize++) {
    assert.deepStrictEqual(await outcome(chunkedGroups(bytes, chunkSize)), expected, `${label}, chunks of ${chunkSize}`);
  }
  return expected;
}

describe("DatasetChunkParser matches readline and groupByTimestamp", () => {
  const rows = [HEADER, row(1, T1), row(2, T1, '"1,3"'), row(3, T2, "7"), row(4, T2), row(5, T3, '"10,11,12"')];

  test("line terminators, BOM and the last line", async () => {
    const cases: Record<string, string> = {
      lf: rows.join("\n"),
      "lf with final newline": `${rows.join("\n")}\n`,
      crlf: rows.join("\r\n"),
      "crlf with final newline": `${rows.join("\r\n")}\r\n`,
      "bom and lf": `${BOM}${rows.join("\n")}\n`,
      "bom and crlf": `${BOM}${rows.join("\r\n")}`,
      "mixed lf and crlf": `${rows.slice(0, 3).join("\r\n")}\n${rows.slice(3).join("\n")}\r\n`,
      "cr alone": rows.join("\r"),
      "cr alone with final cr": `${rows.join("\r")}\r`,
      "cr alone in the middle": `${rows.slice(0, 2).join("\n")}\r${rows.slice(2).join("\n")}`,
      "empty lines": `${rows[0]}\n\n${rows[1]}\r\n\r\n${rows.slice(2).join("\n")}\n\n`,
      "blank line with cr cr lf": `${rows.slice(0, 3).join("\n")}\r\r\n${rows.slice(3).join("\n")}`,
    };
    for (const [label, content] of Object.entries(cases)) {
      const result = await assertSameAsReference(content, label);
      assert.equal(result.error, undefined, label);
      assert.equal(result.groups.length, 3, label);
    }
  });

  test("valid lines outside the fast path", async () => {
    const result = await assertSameAsReference(
      [
        HEADER,
        `1;;${T1};-25.5;-73.9;false;`,
        `1234567890123456;;"${T1}";-25.5;-73.9;false;`,
        `2;;"${T1}";-25.1234567890123456;-73.9;false;"1234567890123456,1"`,
        row(3, T2),
      ].join("\n"),
      "unquoted timestamp, 16-digit ids and long decimals",
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.groups.map((group) => group.records.map((record) => record.id)),
      [[1, 1234567890123456, 2], [3]],
    );
  });

  test("input errors keep their line, field, message and the groups before them", async () => {
    const cases: Record<string, string> = {
      empty: "",
      "only a bom": BOM,
      "only a newline": "\n",
      "header only": HEADER,
      "header only with newline": `${HEADER}\r\n`,
      "wrong header": `${HEADER.replace("id", "Id")}\n${rows[1]}`,
      "invalid field after two groups": [...rows.slice(0, 4), `4;;"${T2}";-25.5;-73.9;yes;`, rows[5]].join("\n"),
      "six fields": [...rows.slice(0, 2), `4;;"${T1}";-25.5;-73.9;false`].join("\r\n"),
      "out of range": [...rows.slice(0, 2), `4;;"${T1}";-95;-73.9;false;`].join("\n"),
      "out of order": [rows[0], row(1, T2), row(2, T3), row(3, T1)].join("\n"),
      "repeated timestamp group": [rows[0], row(1, T1), row(2, T2), row(3, T1)].join("\n"),
      "error on the last line without newline": [...rows.slice(0, 3), `4;;"${T1}";-25.5;-73.9;false;"1,"`].join("\n"),
      "error after a cr alone": `${rows.slice(0, 2).join("\n")}\r\n\rbroken\n${rows[3]}`,
      "non-ascii in an invalid line": [...rows.slice(0, 2), `4;;"${T1}";-25.5;-73.9;verdadeiroé;`].join("\n"),
    };
    for (const [label, content] of Object.entries(cases)) {
      const result = await assertSameAsReference(content, label);
      if (!label.startsWith("header only")) assert.ok(result.error !== undefined, label);
    }
  });

  test("invalid UTF-8 bytes in a line", async () => {
    const bytes = Buffer.concat([
      Buffer.from(`${rows.slice(0, 2).join("\n")}\n4;;"${T1}";-25.5;-73.9;false;"`),
      Buffer.from([0xe2, 0x82]),
      Buffer.from(`"\n${rows[3]}`),
    ]);
    const result = await assertSameAsReference(bytes, "truncated multibyte sequence");
    assert.equal(result.error?.lineNumber, 3);
  });
});

describe("DatasetChunkParser streaming", () => {
  test("yields the groups of a chunk before converting its later lines", () => {
    const content = [HEADER, row(1, T1), row(2, T2), "broken", row(3, T3)].join("\n");
    const parser = new DatasetChunkParser(SOURCE);
    const groups = parser.push(Buffer.from(content));

    assert.equal(groups.next().value?.timestamp, T1);
    assert.throws(() => groups.next(), { name: "DatasetError", lineNumber: 4 });
  });

  test("keeps only the unfinished line between chunks", () => {
    const parser = new DatasetChunkParser(SOURCE);
    assert.deepEqual([...parser.push(Buffer.from(`${HEADER}\n${row(1, T1)}\n${row(2, T2).slice(0, 10)}`))], []);
    const [first] = [...parser.push(Buffer.from(`${row(2, T2).slice(10)}\n`))];
    assert.equal(first?.timestamp, T1);
    const [last] = [...parser.end()];
    assert.deepEqual(last?.records.map((record) => record.id), [2]);
  });

  test("does not depend on chunks being kept by the caller", () => {
    const parser = new DatasetChunkParser(SOURCE);
    const chunk = Buffer.from(`${HEADER}\n${row(1, T1)}\n${row(2, T2).slice(0, 10)}`);
    [...parser.push(chunk)];
    chunk.fill(0x78); // the stream may reuse the memory of a chunk
    [...parser.push(Buffer.from(`${row(2, T2).slice(10)}\n`))];
    assert.deepEqual([...parser.end()][0]?.records[0]?.timestamp, T2);
  });
});
