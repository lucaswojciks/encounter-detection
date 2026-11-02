import assert from "node:assert/strict";
import { test } from "node:test";

import { allPairs } from "../../src/encounters/pair-search.js";
import { record } from "./records.js";

test("allPairs visits every pair i < j exactly once, in input order", () => {
  const records = [record(3), record(1), record(4), record(2)];
  const visited: string[] = [];

  allPairs(records, (a, b) => visited.push(`${a.id}-${b.id}`));

  assert.deepEqual(visited, ["3-1", "3-4", "3-2", "1-4", "1-2", "4-2"]);
});

test("allPairs visits n(n - 1)/2 pairs", () => {
  for (const n of [0, 1, 2, 10, 80]) {
    let count = 0;
    allPairs(Array.from({ length: n }, (_, i) => record(i)), () => count++);
    assert.equal(count, n < 2 ? 0 : (n * (n - 1)) / 2, `n = ${n}`);
  }
});
