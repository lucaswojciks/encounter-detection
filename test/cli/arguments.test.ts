import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "node:test";

import { defaultOutputPath, parseArguments, UsageError } from "../../src/cli/arguments.js";

describe("parseArguments", () => {
  test("dataset only: default output and spatial search", () => {
    assert.deepEqual(parseArguments(["data/dataset1.txt"]), {
      kind: "run",
      input: "data/dataset1.txt",
      output: join("outputs", "encontros-dataset1.json"),
      search: "spatial",
    });
  });

  test("explicit output and search, in any order", () => {
    const expected = { kind: "run", input: "in.txt", output: "out.json", search: "all" };
    assert.deepEqual(parseArguments(["in.txt", "--output", "out.json", "--search", "all"]), expected);
    assert.deepEqual(parseArguments(["--search=all", "-o", "out.json", "in.txt"]), expected);
    assert.deepEqual(parseArguments(["in.txt", "--search", "spatial"]).kind, "run");
  });

  test("help", () => {
    assert.deepEqual(parseArguments(["--help"]), { kind: "help" });
    assert.deepEqual(parseArguments(["-h"]), { kind: "help" });
    assert.deepEqual(parseArguments(["in.txt", "--help"]), { kind: "help" });
  });

  test("usage errors", () => {
    const cases: [string[], RegExp][] = [
      [[], /missing dataset path/],
      [["a.txt", "b.txt"], /expected one dataset path, found 2/],
      [["a.txt", "--search", "fast"], /invalid --search "fast"; expected one of: spatial, all/],
      [["a.txt", "--search"], /argument missing/],
      [["a.txt", "--output"], /argument missing/],
      [["a.txt", "--output="], /--output must not be empty/],
      [["a.txt", "--verbose"], /Unknown option '--verbose'/],
    ];
    for (const [argv, message] of cases) {
      assert.throws(() => parseArguments(argv), (error: unknown) => {
        assert.ok(error instanceof UsageError, `${argv.join(" ")}: ${String(error)}`);
        assert.match(error.message, message);
        return true;
      });
    }
  });

  test("default output name comes from the dataset file name", () => {
    assert.equal(defaultOutputPath("/x/y/dataset7.txt"), join("outputs", "encontros-dataset7.json"));
    assert.equal(defaultOutputPath("records"), join("outputs", "encontros-records.json"));
  });
});
