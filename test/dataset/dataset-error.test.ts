import assert from "node:assert/strict";
import { test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";

test("message includes source, line and field", () => {
  const error = new DatasetError("value is invalid", {
    source: "data/dataset1.txt",
    lineNumber: 12,
    field: "latitude",
  });

  assert.equal(error.message, 'data/dataset1.txt:12: field "latitude": value is invalid');
  assert.equal(error.source, "data/dataset1.txt");
  assert.equal(error.lineNumber, 12);
  assert.equal(error.field, "latitude");
  assert.equal(error.reason, "value is invalid");
  assert.equal(error.name, "DatasetError");
  assert.ok(error instanceof Error);
});

test("message omits the parts that are not known", () => {
  assert.equal(new DatasetError("empty file", { source: "a.txt" }).message, "a.txt: empty file");
  assert.equal(new DatasetError("bad", { lineNumber: 3 }).message, "line 3: bad");
  assert.equal(new DatasetError("bad", { lineNumber: 3, field: "id" }).message, 'line 3: field "id": bad');
  assert.equal(new DatasetError("bad").message, "bad");
});

test("keeps the original error as cause", () => {
  const cause = new Error("ENOENT");
  const error = new DatasetError("cannot read file", { source: "a.txt" }, { cause });

  assert.equal(error.cause, cause);
});
