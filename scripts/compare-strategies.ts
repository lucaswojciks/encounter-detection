// Equivalence check between pair search strategies (spec 003 T06, spec 004 T06).
// Usage: node dist/scripts/compare-strategies.js [--every <k>] <dataset> [...datasets]
// For each compared timestamp group, the encounters found with `spatialHash`
// must be deep-equal to those found with the brute-force reference `allPairs`.
// `--every k` compares only groups 0, k, 2k, ... and the last group (default 1:
// every group).

import { isDeepStrictEqual } from "node:util";

import { readDataset } from "../src/dataset/read-dataset.js";
import type { TimestampGroup } from "../src/dataset/types.js";
import { detectEncounters } from "../src/encounters/detect.js";
import { toOutputEncounter } from "../src/encounters/output.js";
import { allPairs } from "../src/encounters/pair-search.js";
import { spatialHash } from "../src/encounters/spatial-hash.js";

interface Comparison {
  groups: number;
  comparedGroups: number;
  encounters: number;
  mismatchedGroups: number;
}

function compareGroup(group: TimestampGroup, comparison: Comparison): void {
  comparison.comparedGroups++;
  const reference = detectEncounters(group, allPairs);
  const optimized = detectEncounters(group, spatialHash);
  comparison.encounters += reference.length;
  // Compare both the internal encounters and their output form.
  if (
    isDeepStrictEqual(optimized, reference) &&
    isDeepStrictEqual(optimized.map(toOutputEncounter), reference.map(toOutputEncounter))
  ) {
    return;
  }
  comparison.mismatchedGroups++;
  if (comparison.mismatchedGroups <= 5) {
    process.stdout.write(
      `  mismatch at ${group.timestamp}: allPairs=${JSON.stringify(reference.map(toOutputEncounter))} ` +
        `spatialHash=${JSON.stringify(optimized.map(toOutputEncounter))}\n`,
    );
  }
}

async function compare(path: string, every: number): Promise<boolean> {
  const comparison: Comparison = { groups: 0, comparedGroups: 0, encounters: 0, mismatchedGroups: 0 };
  let skipped: TimestampGroup | undefined;
  for await (const group of readDataset(path)) {
    if (comparison.groups++ % every === 0) {
      compareGroup(group, comparison);
      skipped = undefined;
    } else {
      skipped = group;
    }
  }
  if (skipped !== undefined) compareGroup(skipped, comparison); // always include the last group

  const identical = comparison.mismatchedGroups === 0;
  process.stdout.write(`${JSON.stringify({ file: path, every, ...comparison, identical })}\n`);
  return identical;
}

const args = process.argv.slice(2);
let every = 1;
if (args[0] === "--every") {
  every = Number(args[1]);
  args.splice(0, 2);
}
if (args.length === 0 || !Number.isSafeInteger(every) || every < 1) {
  process.stderr.write("Usage: node dist/scripts/compare-strategies.js [--every <k>] <dataset> [...datasets]\n");
  process.exitCode = 1;
} else {
  let allIdentical = true;
  for (const path of args) allIdentical = (await compare(path, every)) && allIdentical;
  if (!allIdentical) process.exitCode = 1;
}
