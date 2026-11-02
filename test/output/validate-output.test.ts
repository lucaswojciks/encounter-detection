import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { readDataset } from "../../src/dataset/read-dataset.js";
import type { LocationRecord } from "../../src/dataset/types.js";
import { haversineDistance } from "../../src/encounters/haversine.js";
import { type DatasetLookup, validateOutput } from "../../src/output/validate-output.js";
import { ANSWERS, officialDataset, skipWithout } from "../official-data.js";

type Encounter = {
  tipo: string;
  monitoradosEncontro: number[];
  timestamp: string;
  posicoes: Record<string, { lat: number; lon: number }>;
  distanciaMetros: number;
};

function answers(name: string): Encounter[] {
  return JSON.parse(readFileSync(new URL(name, ANSWERS), "utf8")) as Encounter[];
}

/** Factions and restriction lists of datasets 1 and 2 (specs/001-dataset-processing/dataset-analysis.md). */
const ATTRIBUTES = {
  "respostas1.json": { factions: { 7: 1, 8: 1 }, restrictions: { 9: [10] } },
  "respostas2.json": { factions: { 8: 1, 9: 1, 10: 2, 11: 2 }, restrictions: { 12: [13] } },
} as const satisfies Record<string, { factions: Record<number, number>; restrictions: Record<number, number[]> }>;

/**
 * Dataset records at the timestamps of the official answers, rebuilt from the
 * answer positions and the known attributes, so that the dataset checks run
 * without the official dataset files.
 */
function lookupFromAnswers(name: keyof typeof ATTRIBUTES): DatasetLookup {
  const { factions, restrictions } = ATTRIBUTES[name] as {
    factions: Record<number, number>;
    restrictions: Record<number, number[]>;
  };
  const byTimestamp = new Map<string, Map<number, LocationRecord>>();
  for (const encounter of answers(name)) {
    const records = byTimestamp.get(encounter.timestamp) ?? new Map<number, LocationRecord>();
    for (const [id, { lat, lon }] of Object.entries(encounter.posicoes)) {
      const restricted = restrictions[Number(id)] ?? [];
      records.set(Number(id), {
        id: Number(id),
        faction: factions[Number(id)] ?? null,
        timestamp: encounter.timestamp,
        latitude: lat,
        longitude: lon,
        hasProtectiveMeasure: restricted.length > 0,
        restrictedIds: restricted,
      });
    }
    byTimestamp.set(encounter.timestamp, records);
  }
  return (timestamp) => byTimestamp.get(timestamp);
}

async function lookupFor(path: string): Promise<DatasetLookup> {
  const byTimestamp = new Map<string, Map<number, LocationRecord>>();
  for await (const group of readDataset(path)) {
    byTimestamp.set(group.timestamp, new Map(group.records.map((record) => [record.id, record])));
  }
  return (timestamp) => byTimestamp.get(timestamp);
}

describe("validateOutput", () => {
  const dataset1 = lookupFromAnswers("respostas1.json");

  test("accepts the official answers checked against the official datasets", { skip: skipWithout("dataset2.txt") || skipWithout("dataset1.txt") }, async () => {
    for (const [name, dataset] of [
      ["respostas1.json", "dataset1.txt"],
      ["respostas2.json", "dataset2.txt"],
    ] as const) {
      const result = validateOutput(answers(name), await lookupFor(officialDataset(dataset) as string));
      assert.deepEqual(result.errors, [], name);
    }
  });

  test("accepts the official answers, with and without the dataset records", () => {
    for (const [name, lookup] of [
      ["respostas1.json", dataset1],
      ["respostas2.json", lookupFromAnswers("respostas2.json")],
    ] as const) {
      for (const result of [validateOutput(answers(name)), validateOutput(answers(name), lookup)]) {
        assert.deepEqual(result.errors, [], name);
        assert.equal(result.errorCount, 0);
      }
    }
    assert.deepEqual(validateOutput(answers("respostas1.json"), dataset1), {
      encounters: 4,
      byType: { generico: 2, faccao: 1, protetiva: 1 },
      errorCount: 0,
      errors: [],
    });
  });

  test("accepts an empty array", () => {
    assert.deepEqual(validateOutput([]), {
      encounters: 0,
      byType: { generico: 0, faccao: 0, protetiva: 0 },
      errorCount: 0,
      errors: [],
    });
  });

  test("rejects a document that is not an array", () => {
    assert.match(validateOutput({}).errors[0] ?? "", /not a JSON array/);
  });

  /** Applies `change` to a copy of the official answers of dataset 1 and expects one error matching `message`. */
  function assertRejects(change: (encounters: Encounter[]) => unknown, message: RegExp, withDataset = false): void {
    const encounters = answers("respostas1.json");
    const document = change(encounters) ?? encounters;
    const result = validateOutput(document, withDataset ? dataset1 : undefined);
    assert.ok(result.errorCount > 0, `expected a violation matching ${message}`);
    assert.ok(
      result.errors.some((error) => message.test(error)),
      `expected ${message}, got ${JSON.stringify(result.errors)}`,
    );
  }

  test("rejects each structural violation", () => {
    assertRejects((list) => {
      delete (list[0] as Partial<Encounter>).tipo;
    }, /keys/);
    assertRejects((list) => {
      const { tipo, ...rest } = list[0] as Encounter;
      list[0] = { ...rest, tipo } as Encounter;
    }, /keys/);
    assertRejects((list) => {
      (list[0] as Encounter).tipo = "outro";
    }, /invalid tipo "outro"/);
    assertRejects((list) => {
      (list[0] as Encounter).monitoradosEncontro = [6, 4];
    }, /two ascending integer ids/);
    assertRejects((list) => {
      (list[0] as Encounter).monitoradosEncontro = [4.5, 6];
    }, /two ascending integer ids/);
    assertRejects((list) => {
      (list[0] as Encounter).timestamp = "2024-01-01T00:05:15";
    }, /invalid timestamp/);
    assertRejects((list) => {
      delete (list[0] as Encounter).posicoes["6"];
    }, /posicoes must hold/);
    assertRejects((list) => {
      (list[0] as Encounter).posicoes["4"] = { lat: "-31.93195" as unknown as number, lon: -40.61438 };
    }, /posicoes must hold/);
  });

  test("rejects distances that are not below 20 m or differ from the recomputed value", () => {
    assertRejects((list) => {
      (list[0] as Encounter).distanciaMetros = 20;
    }, /not a number below 20/);
    assertRejects((list) => {
      (list[0] as Encounter).distanciaMetros = 9.33522817789823 + 1e-12;
    }, /differs from recomputed 9\.33522817789823$/);
    assertRejects((list) => {
      (list[0] as Encounter).posicoes["4"] = { lat: -31.93196, lon: -40.61438 };
    }, /differs from recomputed/);
  });

  test("rejects repeated pairs and out-of-order encounters", () => {
    assertRejects((list) => [list[0], list[0]], /repeated/);
    assertRejects((list) => [list[1], list[0]], /out of order/);
  });

  test("with the dataset, rejects positions or types that differ from the records", () => {
    assertRejects(
      (list) => {
        // Valid distance for the new position, but it is not the dataset's.
        const encounter = list[0] as Encounter;
        encounter.posicoes["4"] = { lat: -31.93194, lon: -40.61438 };
        encounter.distanciaMetros = haversineDistance(-31.93194, -40.61438, -31.93187, -40.61435);
      },
      /posicoes differ from the dataset records/,
      true,
    );
    assertRejects(
      (list) => {
        (list[0] as Encounter).tipo = "faccao";
      },
      /tipo faccao, but the dataset attributes give generico/,
      true,
    );
    assertRejects(
      (list) => {
        (list[0] as Encounter).timestamp = "2024-01-01 00:05:14";
      },
      /not in dataset at 2024-01-01 00:05:14/,
      true,
    );
  });
});
