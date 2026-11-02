import { HEADER } from "../src/dataset/parse-record.js";

/** Shape of the synthetic dataset built by `sampleDataset`. */
export const SAMPLE = {
  timestamps: 50,
  individuals: 10,
  records: 500,
  /** The planted encounters, in output order; every other pair is kilometers apart. */
  encounters: [
    { tipo: "generico", ids: [1, 2], timestamp: "2024-01-01 00:00:50" },
    { tipo: "faccao", ids: [3, 4], timestamp: "2024-01-01 00:01:40" },
    { tipo: "protetiva", ids: [5, 6], timestamp: "2024-01-01 00:02:30" },
  ],
  byType: { generico: 1, faccao: 1, protetiva: 1 },
} as const;

function timestamp(index: number): string {
  const seconds = index * 5;
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `2024-01-01 00:${mm}:${ss}`;
}

/**
 * Synthetic dataset in the official format, independent of the official files:
 * 10 individuals 1° apart in latitude and longitude, 50 timestamps 5 s apart.
 * At timestamps 10, 20 and 30 one individual moves to about 9 m from another,
 * planting one encounter of each type; at timestamp 40, ids 7 and 8 are about
 * 25 m apart, which is not an encounter. Ids 3 and 4 share faction 1, ids 7 and
 * 8 share faction 2, and id 5 has a protective measure against id 6.
 */
export function sampleDataset(): string {
  const lines = [HEADER];
  for (let t = 0; t < SAMPLE.timestamps; t++) {
    const positions = new Map<number, [number, number]>();
    for (let id = 1; id <= SAMPLE.individuals; id++) {
      positions.set(id, [-5 - id + t * 0.0001, -35 - id - t * 0.0001]);
    }
    const near = (moving: number, anchor: number, degrees: number) => {
      const [lat, lon] = positions.get(anchor) as [number, number];
      positions.set(moving, [lat + degrees, lon]);
    };
    if (t === 10) near(2, 1, 0.00008); // ≈ 8.9 m
    if (t === 20) near(4, 3, 0.00008);
    if (t === 30) near(6, 5, 0.00008);
    if (t === 40) near(8, 7, 0.000225); // ≈ 25 m

    for (let id = 1; id <= SAMPLE.individuals; id++) {
      const [lat, lon] = positions.get(id) as [number, number];
      const faction = id === 3 || id === 4 ? "1" : id === 7 || id === 8 ? "2" : "";
      const protective = id === 5;
      lines.push(
        `${id};${faction};"${timestamp(t)}";${lat.toFixed(5)};${lon.toFixed(5)};${protective};${protective ? '"6"' : ""}`,
      );
    }
  }
  return lines.join("\n");
}
