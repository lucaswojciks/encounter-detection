// Equivalence check between the byte reader and the readline reference (spec 001, section 12).
// Usage: node dist/scripts/compare-readers.js <dataset> [...datasets]
// Reads each dataset with `readDataset` and `readDatasetLines` side by side;
// every group (timestamp and records, compared with isDeepStrictEqual) and the
// outcome of the reading (end or error) must be the same.

import { isDeepStrictEqual } from "node:util";

import { readDataset, readDatasetLines } from "../src/dataset/read-dataset.js";
import type { TimestampGroup } from "../src/dataset/types.js";

type Step = { done: false; group: TimestampGroup } | { done: true; error?: string };

async function step(groups: AsyncIterator<TimestampGroup>): Promise<Step> {
  try {
    const result = await groups.next();
    return result.done === true ? { done: true } : { done: false, group: result.value };
  } catch (error) {
    return { done: true, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

async function compare(path: string): Promise<boolean> {
  const bytes = readDataset(path);
  const lines = readDatasetLines(path);
  let groups = 0;
  let records = 0;
  let mismatch: string | undefined;
  let error: string | undefined;
  for (;;) {
    const [fast, reference] = await Promise.all([step(bytes), step(lines)]);
    if (!isDeepStrictEqual(fast, reference)) {
      mismatch =
        `after ${groups} groups: readDataset=${JSON.stringify(fast).slice(0, 300)} ` +
        `readDatasetLines=${JSON.stringify(reference).slice(0, 300)}`;
      break;
    }
    if (fast.done) {
      error = fast.error; // the same in both readers
      break;
    }
    groups++;
    records += fast.group.records.length;
  }
  await Promise.all([bytes.return(undefined), lines.return(undefined)]);

  const identical = mismatch === undefined;
  process.stdout.write(`${JSON.stringify({ file: path, groups, records, identical, error, mismatch })}\n`);
  return identical;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write("Usage: node dist/scripts/compare-readers.js <dataset> [...datasets]\n");
  process.exitCode = 1;
} else {
  let allIdentical = true;
  for (const path of paths) allIdentical = (await compare(path)) && allIdentical;
  if (!allIdentical) process.exitCode = 1;
}
