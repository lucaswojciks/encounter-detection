import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";
import { groupByTimestamp } from "../../src/dataset/group-by-timestamp.js";
import { HEADER } from "../../src/dataset/parse-record.js";
import type { TimestampGroup } from "../../src/dataset/types.js";

const T1 = "2024-01-01 00:00:00";
const T2 = "2024-01-01 00:00:05";
const T3 = "2024-01-01 00:00:10";

function row(id: number, timestamp: string): string {
  return `${id};;"${timestamp}";-25.59386;-73.96319;false;`;
}

async function collect(lines: Iterable<string> | AsyncIterable<string>, source?: string): Promise<TimestampGroup[]> {
  const groups: TimestampGroup[] = [];
  for await (const group of groupByTimestamp(lines, source)) groups.push(group);
  return groups;
}

/** Summarizes groups as `timestamp -> ids` to keep assertions short. */
function shape(groups: readonly TimestampGroup[]): [string, number[]][] {
  return groups.map((group) => [group.timestamp, group.records.map((record) => record.id)]);
}

async function assertDatasetError(
  lines: Iterable<string>,
  expected: { lineNumber?: number; field?: string; message: RegExp },
): Promise<void> {
  await assert.rejects(collect(lines, "input.txt"), (error: unknown) => {
    assert.ok(error instanceof DatasetError);
    assert.equal(error.source, "input.txt");
    assert.equal(error.lineNumber, expected.lineNumber);
    assert.equal(error.field, expected.field);
    assert.match(error.message, expected.message);
    return true;
  });
}

describe("groupByTimestamp", () => {
  test("groups consecutive records with the same timestamp, in input order", async () => {
    const groups = await collect([HEADER, row(2, T1), row(1, T1), row(1, T2), row(2, T2), row(3, T3)]);

    assert.deepEqual(shape(groups), [
      [T1, [2, 1]],
      [T2, [1, 2]],
      [T3, [3]],
    ]);
    assert.deepEqual(groups[0]?.records[0], {
      id: 2,
      faction: null,
      timestamp: T1,
      latitude: -25.59386,
      longitude: -73.96319,
      hasProtectiveMeasure: false,
      restrictedIds: [],
    });
  });

  test("accepts async iterables", async () => {
    async function* lines() {
      yield HEADER;
      yield row(1, T1);
      yield row(1, T2);
    }

    assert.deepEqual(shape(await collect(lines())), [
      [T1, [1]],
      [T2, [1]],
    ]);
  });

  test("a header-only input yields no groups", async () => {
    assert.deepEqual(await collect([HEADER]), []);
  });

  test("ignores empty lines without changing line numbers", async () => {
    const groups = await collect([HEADER, "", row(1, T1), "", row(2, T1), ""]);
    assert.deepEqual(shape(groups), [[T1, [1, 2]]]);

    await assertDatasetError([HEADER, "", "", "bad"], { lineNumber: 4, message: /^input\.txt:4: expected 7 fields/ });
  });

  test("handles CRLF line endings and a BOM", async () => {
    const lf = await collect([HEADER, row(1, T1), row(1, T2)]);
    const bom = String.fromCharCode(0xfeff);
    const crlf = await collect([`${bom}${HEADER}\r`, `${row(1, T1)}\r`, `${row(1, T2)}\r`, "\r"]);

    assert.deepEqual(crlf, lf);
  });

  test("emits a new array for each group", async () => {
    const groups = await collect([HEADER, row(1, T1), row(1, T2)]);

    assert.notEqual(groups[0]?.records, groups[1]?.records);
    assert.equal(groups[0]?.records.length, 1);
  });

  test("rejects an empty input", async () => {
    await assertDatasetError([], { message: /^input\.txt: empty input: missing header$/ });
  });

  test("rejects a wrong header", async () => {
    await assertDatasetError(["id;faccao;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida"], {
      lineNumber: 1,
      message: /^input\.txt:1: expected header/,
    });
    await assertDatasetError([row(1, T1)], { lineNumber: 1, message: /^input\.txt:1: expected header/ });
  });

  test("propagates record errors with line and field", async () => {
    await assertDatasetError([HEADER, row(1, T1), "1;;\"2024-01-01 00:00:05\";91.0;0.0;false;"], {
      lineNumber: 3,
      field: "latitude",
      message: /^input\.txt:3: field "latitude": "91.0" is outside \[-90, 90\]$/,
    });
  });

  test("rejects a timestamp earlier than the previous one, yielding no later groups", async () => {
    const yielded: string[] = [];
    await assert.rejects(
      (async () => {
        for await (const group of groupByTimestamp([HEADER, row(1, T2), row(1, T3), row(1, T1)], "input.txt")) {
          yielded.push(group.timestamp);
        }
      })(),
      {
        name: "DatasetError",
        lineNumber: 4,
        field: "timestamp",
        message: new RegExp(`^input\\.txt:4: field "timestamp": timestamp "${T1}" is earlier than`),
      },
    );
    assert.deepEqual(yielded, [T2]);
  });

  test("rejects a timestamp that reappears after another group", async () => {
    await assertDatasetError([HEADER, row(1, T1), row(1, T2), row(2, T1)], {
      lineNumber: 4,
      field: "timestamp",
      message: /is earlier than the previous timestamp/,
    });
  });
});

describe("groupByTimestamp backpressure", () => {
  /** Line source that records how many lines were pulled and whether it was closed. */
  function instrumentedLines(lines: readonly string[]) {
    const state = { pulled: 0, closed: false };
    const iterable: Iterable<string> = {
      [Symbol.iterator]() {
        return {
          next() {
            if (state.pulled >= lines.length) return { done: true, value: undefined };
            return { done: false, value: lines[state.pulled++] as string };
          },
          return() {
            state.closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    return { iterable, state };
  }

  const lines = [HEADER, row(1, T1), row(2, T1), row(1, T2), row(2, T2), row(1, T3), row(2, T3)];

  test("reads only up to the first line of the next group before yielding", async () => {
    const { iterable, state } = instrumentedLines(lines);
    const groups = groupByTimestamp(iterable);

    const first = await groups.next();
    assert.equal(first.done, false);
    assert.equal(state.pulled, 4); // header, two T1 rows and the first T2 row

    await groups.next();
    assert.equal(state.pulled, 6);
  });

  test("closes the line source when the consumer stops early", async () => {
    const { iterable, state } = instrumentedLines(lines);

    for await (const group of groupByTimestamp(iterable)) {
      assert.equal(group.timestamp, T1);
      break;
    }

    assert.equal(state.closed, true);
    assert.equal(state.pulled, 4);
  });
});
