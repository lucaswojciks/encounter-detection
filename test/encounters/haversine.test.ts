import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EARTH_RADIUS_METERS, haversineDistance } from "../../src/encounters/haversine.js";
import { readOfficialAnswers } from "./official-answers.js";

const OFFICIAL = [...readOfficialAnswers("respostas1.json"), ...readOfficialAnswers("respostas2.json")];

describe("haversineDistance", () => {
  test("uses an Earth radius of 6,371,000 m", () => {
    assert.equal(EARTH_RADIUS_METERS, 6_371_000);
  });

  test("reproduces the 10 official distances bit for bit, in both argument orders", () => {
    assert.equal(OFFICIAL.length, 10);
    for (const answer of OFFICIAL) {
      const [a, b] = answer.monitoradosEncontro.map((id) => answer.posicoes[id]);
      assert.ok(a && b);
      const label = `${answer.monitoradosEncontro.join("-")} at ${answer.timestamp}`;
      assert.equal(haversineDistance(a.lat, a.lon, b.lat, b.lon), answer.distanciaMetros, label);
      assert.equal(haversineDistance(b.lat, b.lon, a.lat, a.lon), answer.distanciaMetros, `${label} (swapped)`);
    }
  });

  test("multiplies the cosine product by sin² as a single term", () => {
    // Dataset 4, pair 31-43 at 2024-01-01 02:03:15. Grouping the product as
    // ((cos1 * cos2) * s) * s gives 10.584413373886987, one ulp below. Both
    // groupings match the official answers; this pins the documented choice
    // (spec 002, plan section 4).
    assert.equal(haversineDistance(-18.80665, -41.26235, -18.80666, -41.26225), 10.584413373886989);
  });

  test("the same point is at distance zero", () => {
    assert.equal(haversineDistance(-25.59386, -73.96319, -25.59386, -73.96319), 0);
  });

  test("one degree of latitude along a meridian equals R * PI / 180", () => {
    const expected = (EARTH_RADIUS_METERS * Math.PI) / 180;
    assert.ok(Math.abs(haversineDistance(-10, -50, -11, -50) - expected) < 1e-6);
  });
});
