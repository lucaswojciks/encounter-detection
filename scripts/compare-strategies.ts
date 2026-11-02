// Equivalence check between pair search strategies (spec 003, T06).
// Usage: node dist/scripts/compare-strategies.js <dataset> [...datasets]
// For every timestamp group, the encounters found with `spatialHash` must be
// deep-equal to those found with the brute-force reference `allPairs`.

import { isDeepStrictEqual } from "node:util";

import { readDataset } from "../src/dataset/read-dataset.js";
import { detectEncounters } from "../src/encounters/detect.js";
import { toOutputEncounter } from "../src/encounters/output.js";
import { allPairs } from "../src/encounters/pair-search.js";
import { spatialHash } from "../src/encounters/spatial-hash.js";

async function compare(path: string): Promise<boolean> {
  let groups = 0;
  let encounters = 0;
  let mismatchedGroups = 0;
  for await (const group of readDataset(path)) {
    groups++;
    const reference = detectEncounters(group, allPairs);
    const optimized = detectEncounters(group, spatialHash);
    encounters += reference.length;
    // Compare both the internal encounters and their output form.
    if (
      !isDeepStrictEqual(optimized, reference) ||
      !isDeepStrictEqual(optimized.map(toOutputEncounter), reference.map(toOutputEncounter))
    ) {
      mismatchedGroups++;
      if (mismatchedGroups <= 5) {
        process.stdout.write(
          `  mismatch at ${group.timestamp}: allPairs=${JSON.stringify(reference.map(toOutputEncounter))} ` +
            `spatialHash=${JSON.stringify(optimized.map(toOutputEncounter))}\n`,
        );
      }
    }
  }
  const identical = mismatchedGroups === 0;
  process.stdout.write(`${JSON.stringify({ file: path, groups, encounters, mismatchedGroups, identical })}\n`);
  return identical;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write("Usage: node dist/scripts/compare-strategies.js <dataset> [...datasets]\n");
  process.exitCode = 1;
} else {
  let allIdentical = true;
  for (const path of paths) allIdentical = (await compare(path)) && allIdentical;
  if (!allIdentical) process.exitCode = 1;
}
