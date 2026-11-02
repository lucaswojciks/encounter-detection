import assert from "node:assert/strict";
import { type FileHandle, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";
import { HEADER } from "../../src/dataset/parse-record.js";
import { CHUNK_SIZE, readDataset, readDatasetLines } from "../../src/dataset/read-dataset.js";
import type { TimestampGroup } from "../../src/dataset/types.js";

const fsPromises = createRequire(import.meta.url)("node:fs/promises") as typeof import("node:fs/promises");

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

    const bom = String.fromCharCode(0xfeff);
    const variants = {
      "lf-trailing.txt": `${lines.join("\n")}\n`,
      "crlf.txt": lines.join("\r\n"),
      "crlf-trailing.txt": `${lines.join("\r\n")}\r\n`,
      "bom.txt": `${bom}${lines.join("\n")}`,
      "bom-crlf.txt": `${bom}${lines.join("\r\n")}\r\n`,
    };
    for (const [name, content] of Object.entries(variants)) {
      assert.deepEqual(await collect(await fileWith(name, content)), expected, name);
    }
  });

  test("a file starting with the UTF-8 BOM bytes EF BB BF is read like one without it", async () => {
    const lines = [HEADER, ...ROWS].join("\n");
    const expected = await collect(await fileWith("no-bom.txt", lines));
    const path = join(directory, "bom-bytes.txt");
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lines, "utf8")]));

    assert.deepEqual(await collect(path), expected);
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

  test("equals the readline reference on a multi-chunk file with CRLF and lines across chunk borders", async () => {
    const lines = [HEADER];
    for (let second = 0; second < 60; second++) {
      const timestamp = `2024-01-01 00:${String(second).padStart(2, "0")}:00`;
      for (let id = 1; id <= 1000; id++) {
        const restricted = id % 7 === 0 ? `"${id + 1},${id + 2}"` : "";
        lines.push(`${id};${id % 4 || ""};"${timestamp}";-${id % 80}.${second}1234;-4${id % 10}.98765;${id % 7 === 0};${restricted}`);
      }
    }
    const path = await fileWith("large-crlf.txt", `${lines.join("\r\n")}\r\n`);
    assert.ok((await stat(path)).size > 2 * CHUNK_SIZE);

    const groups = await collect(path);
    const reference: TimestampGroup[] = [];
    for await (const group of readDatasetLines(path)) reference.push(group);
    assert.equal(groups.length, 60);
    assert.deepStrictEqual(groups, reference);
  });

  test("closes the file when the reading ends, fails or is stopped early by the consumer", async (t) => {
    // Keeps every handle opened by readDataset; a closed FileHandle has fd -1.
    const handles: FileHandle[] = [];
    const open = fsPromises.open;
    const spy = t.mock.method(fsPromises, "open", async (...args: Parameters<typeof open>) => {
      const handle = await open(...args);
      handles.push(handle);
      return handle;
    });
    syncBuiltinESMExports(); // makes the ESM import of `open` in readDataset see the spy
    try {
      const valid = await fileWith("stop.txt", [HEADER, ...ROWS].join("\n"));
      await collect(valid);
      for await (const group of readDataset(valid)) {
        assert.equal(group.timestamp, "2024-01-01 00:00:00");
        break;
      }
      const invalid = await fileWith("fail.txt", [HEADER, ROWS[0], "broken", ROWS[2]].join("\n"));
      await assert.rejects(collect(invalid), { name: "DatasetError", lineNumber: 3 });
    } finally {
      spy.mock.restore();
      syncBuiltinESMExports();
    }

    assert.equal(handles.length, 3);
    assert.deepEqual(handles.map((handle) => handle.fd), [-1, -1, -1]);
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
