import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DatasetError } from "../../src/dataset/dataset-error.js";
import { parseRecord } from "../../src/dataset/parse-record.js";

const VALID_FIELDS = ["9", "", '"2024-01-01 00:00:00"', "1.64046", "-69.53947", "true", '"10"'];
const FIELD_INDEX = {
  idMonitorado: 0,
  faccaoMonitorado: 1,
  timestamp: 2,
  latitude: 3,
  longitude: 4,
  medidaProtetiva: 5,
  idsRestricaoMedida: 6,
} as const;

type FieldName = keyof typeof FIELD_INDEX;

function lineWith(field: FieldName, value: string): string {
  const fields = [...VALID_FIELDS];
  fields[FIELD_INDEX[field]] = value;
  return fields.join(";");
}

function parseField(field: FieldName, value: string) {
  return parseRecord(lineWith(field, value), 2);
}

function assertRejected(field: FieldName, value: string): void {
  assert.throws(
    () => parseField(field, value),
    (error: unknown) => {
      assert.ok(error instanceof DatasetError);
      assert.equal(error.field, field, `wrong field for ${JSON.stringify(value)}`);
      assert.equal(error.lineNumber, 2);
      return true;
    },
    `${field} should reject ${JSON.stringify(value)}`,
  );
}

describe("parseRecord", () => {
  test("converts real lines from dataset 1", () => {
    assert.deepEqual(parseRecord('9;;"2024-01-01 00:00:00";1.64046;-69.53947;true;"10"', 10), {
      id: 9,
      faction: null,
      timestamp: "2024-01-01 00:00:00",
      latitude: 1.64046,
      longitude: -69.53947,
      hasProtectiveMeasure: true,
      restrictedIds: [10],
    });
    assert.deepEqual(parseRecord('7;1;"2024-01-01 00:00:00";-13.06443;-46.56289;false;', 8), {
      id: 7,
      faction: 1,
      timestamp: "2024-01-01 00:00:00",
      latitude: -13.06443,
      longitude: -46.56289,
      hasProtectiveMeasure: false,
      restrictedIds: [],
    });
  });

  test("rejects lines without exactly 7 fields, reporting source and line", () => {
    for (const line of ["1;;\"2024-01-01 00:00:00\";1.0;1.0;false", `${VALID_FIELDS.join(";")};`]) {
      assert.throws(
        () => parseRecord(line, 7, "input.txt"),
        (error: unknown) => {
          assert.ok(error instanceof DatasetError);
          assert.equal(error.source, "input.txt");
          assert.equal(error.lineNumber, 7);
          assert.equal(error.field, undefined);
          assert.match(error.message, /^input\.txt:7: expected 7 fields/);
          return true;
        },
      );
    }
  });

  test("reports the source in field errors", () => {
    assert.throws(() => parseRecord(lineWith("latitude", "x"), 4, "data/a.txt"), {
      message: 'data/a.txt:4: field "latitude": "x" is not a decimal number',
    });
  });
});

describe("idMonitorado", () => {
  test("accepts non-negative integers", () => {
    assert.equal(parseField("idMonitorado", "1").id, 1);
    assert.equal(parseField("idMonitorado", "120").id, 120);
    assert.equal(parseField("idMonitorado", "9007199254740991").id, 9007199254740991);
  });

  test("rejects values that are not decimal integers", () => {
    for (const value of ["", "-1", "1.0", "1e3", "0x10", " 1", "1 ", "a", "9007199254740992"]) {
      assertRejected("idMonitorado", value);
    }
  });
});

describe("faccaoMonitorado", () => {
  test("empty means no faction", () => {
    assert.equal(parseField("faccaoMonitorado", "").faction, null);
  });

  test("accepts integers", () => {
    assert.equal(parseField("faccaoMonitorado", "1").faction, 1);
    assert.equal(parseField("faccaoMonitorado", "12").faction, 12);
  });

  test("rejects values that are not decimal integers", () => {
    for (const value of ["-1", "1.5", "a", " "]) {
      assertRejected("faccaoMonitorado", value);
    }
  });
});

describe("timestamp", () => {
  test("keeps the input text, removing only the delimiting quotes", () => {
    assert.equal(parseField("timestamp", '"2024-01-01 00:00:00"').timestamp, "2024-01-01 00:00:00");
    assert.equal(parseField("timestamp", "2024-01-05 15:06:35").timestamp, "2024-01-05 15:06:35");
  });

  test("rejects values outside the YYYY-MM-DD HH:MM:SS format", () => {
    for (const value of [
      "",
      '""',
      '"',
      '"2024-01-01T00:00:00"',
      '"2024-01-01 00:00"',
      '"2024-01-01 00:00:00Z"',
      '"2024-01-01 00:00:00',
      '2024-01-01 00:00:00"',
      "'2024-01-01 00:00:00'",
    ]) {
      assertRejected("timestamp", value);
    }
  });
});

describe("latitude and longitude", () => {
  test("accepts decimal numbers within the geographic limits", () => {
    assert.equal(parseField("latitude", "-25.59386").latitude, -25.59386);
    assert.equal(parseField("latitude", "90").latitude, 90);
    assert.equal(parseField("latitude", "-90.00000").latitude, -90);
    assert.equal(parseField("latitude", "+1.5").latitude, 1.5);
    assert.equal(parseField("longitude", "180.00000").longitude, 180);
    assert.equal(parseField("longitude", "-180").longitude, -180);
    assert.equal(parseField("longitude", "-44.63520").longitude, -44.6352);
  });

  test("rejects values outside the limits", () => {
    assertRejected("latitude", "90.00001");
    assertRejected("latitude", "-90.00001");
    assertRejected("longitude", "180.00001");
    assertRejected("longitude", "-180.00001");
  });

  test("rejects values that are not decimal numbers", () => {
    for (const value of ["", "1e1", ".5", "1.", "0x1", " 1.0", "1,5", "NaN", "Infinity"]) {
      assertRejected("latitude", value);
      assertRejected("longitude", value);
    }
  });
});

describe("medidaProtetiva", () => {
  test("accepts true and false", () => {
    assert.equal(parseField("medidaProtetiva", "true").hasProtectiveMeasure, true);
    assert.equal(parseField("medidaProtetiva", "false").hasProtectiveMeasure, false);
  });

  test("rejects other values", () => {
    for (const value of ["", "TRUE", "False", "1", "0", '"true"']) {
      assertRejected("medidaProtetiva", value);
    }
  });
});

describe("idsRestricaoMedida", () => {
  test("empty means no restrictions", () => {
    assert.deepEqual(parseField("idsRestricaoMedida", "").restrictedIds, []);
  });

  test("accepts one or more ids, with or without quotes, keeping the order", () => {
    assert.deepEqual(parseField("idsRestricaoMedida", '"10"').restrictedIds, [10]);
    assert.deepEqual(parseField("idsRestricaoMedida", "10").restrictedIds, [10]);
    assert.deepEqual(parseField("idsRestricaoMedida", '"10,11"').restrictedIds, [10, 11]);
    assert.deepEqual(parseField("idsRestricaoMedida", '"52,3,17"').restrictedIds, [52, 3, 17]);
    assert.deepEqual(parseField("idsRestricaoMedida", "10,11").restrictedIds, [10, 11]);
  });

  test("rejects malformed lists", () => {
    for (const value of ['""', '"10,"', '",10"', '"10,,11"', '"10, 11"', '"a"', '"10', '10"', '"-1"']) {
      assertRejected("idsRestricaoMedida", value);
    }
  });
});
