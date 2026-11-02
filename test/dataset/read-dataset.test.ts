import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";
import { HEADER } from "../../src/dataset/parse-record.js";
import { readDataset } from "../../src/dataset/read-dataset.js";
import type { TimestampGroup } from "../../src/dataset/types.js";

const ROWS = [
  '1;;"2024-01-01 00:00:00";-25.59386;-73.96319;false;',
  '2;1;"2024-01-01 00:00:00";-21.15463;-61.43519;true;"1,3"',
  '1;;"2024-01-01 00:00:05";-25.59390;-73.96320;false;',
];

async function collect(path: string): Promise<TimestampGroup[]> {
  const groups: TimestampGroup[] = [];
  for await (const group of readDataset(path)) groups.push(group);
  return groups;
}

describe("readDataset", () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "encounter-detection-"));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function fileWith(name: string, content: string): Promise<string> {
    const path = join(directory, name);
    await writeFile(path, content, "utf8");
    return path;
  }

  test("reads groups from a file", async () => {
    const groups = await collect(await fileWith("lf.txt", [HEADER, ...ROWS].join("\n")));

    assert.deepEqual(
      groups.map((group) => [group.timestamp, group.records.length]),
      [
        ["2024-01-01 00:00:00", 2],
        ["2024-01-01 00:00:05", 1],
      ],
    );
    assert.deepEqual(groups[0]?.records[1], {
      id: 2,
      faction: 1,
      timestamp: "2024-01-01 00:00:00",
      latitude: -21.15463,
      longitude: -61.43519,
      hasProtectiveMeasure: true,
      restrictedIds: [1, 3],
    });
  });

  test("LF, CRLF, BOM and trailing newline variants yield the same groups", async () => {
    const lines = [HEADER, ...ROWS];
    const expected = await collect(await fileWith("base.txt", lines.join("\n")));

    const variants = {
      "lf-trailing.txt": `${lines.join("\n")}\n`,
      "crlf.txt": lines.join("\r\n"),
      "crlf-trailing.txt": `${lines.join("\r\n")}\r\n`,
      "bom.txt": `﻿${lines.join("\n")}`,
      "bom-crlf.txt": `﻿${lines.join("\r\n")}\r\n`,
    };
    for (const [name, content] of Object.entries(variants)) {
      assert.deepEqual(await collect(await fileWith(name, content)), expected, name);
    }
  });

  test("reports the file path and line of an invalid record", async () => {
    const path = await fileWith("invalid.txt", [HEADER, ROWS[0], "2;;\"2024-01-01 00:00:00\";-21.1;-61.4;yes;"].join("\n"));

    await assert.rejects(collect(path), (error: unknown) => {
      assert.ok(error instanceof DatasetError);
      assert.equal(error.source, path);
      assert.equal(error.lineNumber, 3);
      assert.equal(error.field, "medidaProtetiva");
      assert.equal(error.message, `${path}:3: field "medidaProtetiva": "yes" is not "true" or "false"`);
      return true;
    });
  });

  test("reports an empty file", async () => {
    const path = await fileWith("empty.txt", "");

    await assert.rejects(collect(path), { name: "DatasetError", message: `${path}: empty input: missing header` });
  });

  test("reports a missing file", async () => {
    const path = join(directory, "missing.txt");

    await assert.rejects(collect(path), (error: unknown) => {
      assert.ok(error instanceof DatasetError);
      assert.equal(error.source, path);
      assert.match(error.message, /cannot read file: ENOENT/);
      assert.equal((error.cause as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
  });
});
