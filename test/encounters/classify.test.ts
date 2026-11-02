import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { classifyEncounter } from "../../src/encounters/classify.js";
import { record } from "./records.js";

function assertType(a: Parameters<typeof classifyEncounter>[0], b: typeof a, expected: string): void {
  assert.equal(classifyEncounter(a, b), expected);
  assert.equal(classifyEncounter(b, a), expected, "classification must not depend on argument order");
}

describe("classifyEncounter", () => {
  test("faccao: both individuals have the same faction", () => {
    assertType(record(7, { faction: 1 }), record(8, { faction: 1 }), "faccao");
  });

  test("generico: neither has a faction", () => {
    assertType(record(4), record(6), "generico");
  });

  test("generico: different factions", () => {
    assertType(record(7, { faction: 1 }), record(10, { faction: 2 }), "generico");
  });

  test("generico: only one has a faction", () => {
    assertType(record(7, { faction: 1 }), record(3), "generico");
  });

  test("protetiva: one lists the other in its restrictions", () => {
    const protectedPerson = record(9, { hasProtectiveMeasure: true, restrictedIds: [10] });
    assertType(protectedPerson, record(10), "protetiva");
  });

  test("protetiva: both list each other", () => {
    assertType(record(1, { restrictedIds: [2] }), record(2, { restrictedIds: [1] }), "protetiva");
  });

  test("protetiva: list with several ids containing the other", () => {
    assertType(record(1, { hasProtectiveMeasure: true, restrictedIds: [5, 2, 9] }), record(2), "protetiva");
  });

  test("generico: an individual with restrictions meets someone not in the list", () => {
    assertType(record(9, { hasProtectiveMeasure: true, restrictedIds: [10] }), record(3), "generico");
  });
});
