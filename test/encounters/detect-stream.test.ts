import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";
import { groupByTimestamp } from "../../src/dataset/group-by-timestamp.js";
import { HEADER } from "../../src/dataset/parse-record.js";
import type { TimestampGroup } from "../../src/dataset/types.js";
import { detectDatasetEncounters } from "../../src/encounters/detect-stream.js";
import type { Encounter } from "../../src/encounters/types.js";

const T1 = "2024-01-01 01:00:30";
const T2 = "2024-01-01 01:00:35";
const T3 = "2024-01-01 01:00:40";
const T4 = "2024-01-01 01:00:45";

function row(id: number, timestamp: string, latitude: string, longitude = "-40.61438"): string {
  return `${id};;"${timestamp}";${latitude};${longitude};false;`;
}

async function collect(lines: readonly string[]): Promise<Encounter[]> {
  const encounters: Encounter[] = [];
  for await (const encounter of detectDatasetEncounters(groupByTimestamp(lines))) encounters.push(encounter);
  return encounters;
}

function summary(encounters: readonly Encounter[]): string[] {
  return encounters.map((e) => `${e.timestamp} ${e.first.id}-${e.second.id}`);
}

describe("detectDatasetEncounters", () => {
  test("only records with the same timestamp are compared", async () => {
    // Same position, but at different timestamps.
    const encounters = await collect([HEADER, row(1, T1, "-31.93195"), row(2, T2, "-31.93195")]);

    assert.deepEqual(encounters, []);
  });

  test("a pair close in consecutive timestamps produces one encounter per timestamp", async () => {
    const lines = [HEADER];
    for (const timestamp of [T1, T2, T3]) {
      lines.push(row(28, timestamp, "-31.93195"), row(31, timestamp, "-31.93187"));
    }
    lines.push(row(28, T4, "-31.93195"), row(31, T4, "-31.94195")); // about 1.1 km apart

    assert.deepEqual(summary(await collect(lines)), [`${T1} 28-31`, `${T2} 28-31`, `${T3} 28-31`]);
  });

  test("yields the encounters of a group before reading the next group", async () => {
    const lines = groupByTimestamp([
      HEADER,
      row(1, T1, "-31.93195"),
      row(2, T1, "-31.93187"),
      row(1, T2, "-31.93195"),
      row(2, T2, "-31.93187"),
    ]);
    let groupsRead = 0;
    async function* countingGroups(): AsyncGenerator<TimestampGroup> {
      for await (const group of lines) {
        groupsRead++;
        yield group;
      }
    }

    const encounters = detectDatasetEncounters(countingGroups());
    const first = await encounters.next();

    assert.equal(first.done, false);
    assert.equal(groupsRead, 1);
    await encounters.next();
    assert.equal(groupsRead, 2);
  });

  test("propagates input errors to the consumer", async () => {
    await assert.rejects(collect([HEADER, row(1, T2, "-31.93195"), row(1, T1, "-31.93195")]), (error: unknown) => {
      assert.ok(error instanceof DatasetError);
      assert.equal(error.lineNumber, 3);
      return true;
    });
  });
});
