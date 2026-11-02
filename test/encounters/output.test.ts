import assert from "node:assert/strict";
import { test } from "node:test";

import { toOutputEncounter } from "../../src/encounters/output.js";
import { readOfficialAnswers } from "./official-answers.js";
import { record } from "./records.js";

test("maps an encounter to the official structure with keys in the official order", () => {
  const output = toOutputEncounter({
    type: "protetiva",
    timestamp: "2024-01-01 00:16:45",
    first: record(9, { latitude: 1.83355, longitude: -69.5461, restrictedIds: [10] }),
    second: record(10, { latitude: 1.83351, longitude: -69.54618 }),
    distanceMeters: 9.941503149375345,
  });

  assert.deepEqual(Object.keys(output), ["tipo", "monitoradosEncontro", "timestamp", "posicoes", "distanciaMetros"]);
  assert.deepEqual(Object.keys(output.posicoes), ["9", "10"]);
  assert.deepEqual(Object.keys(output.posicoes["9"] ?? {}), ["lat", "lon"]);
  assert.equal(
    JSON.stringify(output, null, 2),
    JSON.stringify(readOfficialAnswers("respostas1.json")[2], null, 2),
    "must match the third official encounter of dataset 1",
  );
});

test("keeps values unchanged and ids in ascending order", () => {
  const output = toOutputEncounter({
    type: "generico",
    timestamp: "2024-01-05 15:06:35",
    first: record(3, { latitude: -28.28206, longitude: -44.63511 }),
    second: record(100, { latitude: -28.28207, longitude: -44.6352 }),
    distanceMeters: 8.882771981092958,
  });

  assert.deepEqual(output, {
    tipo: "generico",
    monitoradosEncontro: [3, 100],
    timestamp: "2024-01-05 15:06:35",
    posicoes: { 3: { lat: -28.28206, lon: -44.63511 }, 100: { lat: -28.28207, lon: -44.6352 } },
    distanciaMetros: 8.882771981092958,
  });
  assert.deepEqual(Object.keys(output.posicoes), ["3", "100"]);
});
