import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, before, describe, test } from "node:test";

import { writeJsonArray } from "../../src/output/json-writer.js";

const OFFICIAL = new URL("../../../test/fixtures/official/", import.meta.url);

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

describe("writeJsonArray", () => {
  let directory: string;
  let counter = 0;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), "encounter-writer-"));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  /** A fresh empty directory and an output path inside it. */
  async function target(): Promise<{ dir: string; path: string }> {
    const dir = join(directory, `case-${counter++}`);
    await mkdir(dir);
    return { dir, path: join(dir, "out.json") };
  }

  test("writes the same text as JSON.stringify(list, null, 2)", async () => {
    const lists: unknown[][] = [
      [],
      [{ a: 1 }],
      [{ a: 1, b: [1, 2], c: { d: "x\ny" } }, { e: null }, [3, { f: -0.5 }], "text", 7],
    ];
    for (const list of lists) {
      const { path } = await target();
      const count = await writeJsonArray(list, path);
      assert.equal(count, list.length);
      assert.equal(await readFile(path, "utf8"), JSON.stringify(list, null, 2));
    }
  });

  test("an empty list is written as []", async () => {
    const { path } = await target();
    await writeJsonArray([], path);
    assert.equal(await readFile(path, "utf8"), "[]");
  });

  test("reproduces the official answer files byte for byte", async () => {
    for (const name of ["respostas1.json", "respostas2.json"]) {
      const official = await readFile(new URL(name, OFFICIAL), "utf8");
      const { path } = await target();
      await writeJsonArray(JSON.parse(official) as unknown[], path);
      assert.equal(await readFile(path, "utf8"), official, name);
    }
  });

  test("writes incrementally to a temporary file and publishes only at the end", async () => {
    const { dir, path } = await target();
    const observations: { finalExists: boolean; temporarySize: number }[] = [];

    async function* items() {
      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          const temporary = (await readdir(dir)).filter((name) => name.startsWith(`.${basename(path)}.`));
          assert.equal(temporary.length, 1);
          observations.push({
            finalExists: await exists(path),
            temporarySize: (await stat(join(dir, temporary[0] as string))).size,
          });
        }
        yield { item: i };
      }
    }

    await writeJsonArray(items(), path, { flushBytes: 1 });

    assert.deepEqual(
      observations.map((o) => o.finalExists),
      [false, false],
    );
    const [first, second] = observations.map((o) => o.temporarySize) as [number, number];
    assert.ok(first > 0, "first item flushed before the second is produced");
    assert.ok(second > first, "temporary file grows as items are written");
    assert.equal(await readFile(path, "utf8"), JSON.stringify([{ item: 0 }, { item: 1 }, { item: 2 }], null, 2));
    assert.deepEqual(await readdir(dir), ["out.json"], "no temporary file left");
  });

  test("a failure while producing items leaves no output and no temporary file", async () => {
    const { dir, path } = await target();
    async function* failing() {
      yield { a: 1 };
      yield { a: 2 };
      throw new Error("detector failed");
    }

    await assert.rejects(writeJsonArray(failing(), path, { flushBytes: 1 }), { message: "detector failed" });
    assert.deepEqual(await readdir(dir), []);
  });

  test("a failure keeps a previous output file intact", async () => {
    const { dir, path } = await target();
    await writeFile(path, "previous result", "utf8");
    async function* failing() {
      yield { a: 1 };
      throw new Error("interrupted");
    }

    await assert.rejects(writeJsonArray(failing(), path), { message: "interrupted" });
    assert.equal(await readFile(path, "utf8"), "previous result");
    assert.deepEqual(await readdir(dir), ["out.json"]);
  });

  test("replaces a previous output file on success", async () => {
    const { path } = await target();
    await writeFile(path, "previous result", "utf8");
    await writeJsonArray([{ a: 1 }], path);
    assert.equal(await readFile(path, "utf8"), JSON.stringify([{ a: 1 }], null, 2));
  });

  test("rejects a destination that is a directory, without leaving a temporary file", async () => {
    const { dir } = await target();
    const destination = join(dir, "is-a-directory");
    await mkdir(destination);

    await assert.rejects(writeJsonArray([{ a: 1 }], destination));
    assert.deepEqual(await readdir(dir), ["is-a-directory"]);
  });

  test("rejects a destination in a missing directory", async () => {
    const { dir } = await target();
    await assert.rejects(writeJsonArray([], join(dir, "missing", "out.json")), { code: "ENOENT" });
  });
});
