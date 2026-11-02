import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The official datasets are not versioned. Tests that need them read them from
 * `data/` (or from the directory in ENCOUNTER_DATA_DIR) and are skipped when the
 * file is not there, so `npm test` needs no download and no internet access.
 * The official answers are small and stay in test/fixtures/official/.
 */
// Compiled tests run from dist/test; data/ and the fixtures stay in the source tree.
const DATA_DIRECTORY = process.env.ENCOUNTER_DATA_DIR ?? fileURLToPath(new URL("../../data/", import.meta.url));
export const ANSWERS = new URL("../../test/fixtures/official/", import.meta.url);

/** Path of an official dataset, or `undefined` when it is not available locally. */
export function officialDataset(name: string): string | undefined {
  const path = join(DATA_DIRECTORY, name);
  return existsSync(path) ? path : undefined;
}

/** `skip` option for a test that needs the official dataset `name`. */
export function skipWithout(name: string): string | false {
  return officialDataset(name) === undefined ? `${name} not found in ${DATA_DIRECTORY}` : false;
}

export const answerPath = (name: string) => fileURLToPath(new URL(name, ANSWERS));
