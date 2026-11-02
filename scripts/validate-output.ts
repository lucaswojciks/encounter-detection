// Independent validation of an output file (spec 004, VAL-02).
// Usage: node dist/scripts/validate-output.js <output.json> [--dataset <dataset.txt>]
// Exits with 1 when the file breaks any output rule.

import { readFile } from "node:fs/promises";

import { readDataset } from "../src/dataset/read-dataset.js";
import type { LocationRecord } from "../src/dataset/types.js";
import { validateOutput } from "../src/output/validate-output.js";

/** Records of the dataset at the given timestamps only, read in streaming. */
async function datasetRecords(path: string, timestamps: ReadonlySet<string>) {
  const byTimestamp = new Map<string, Map<number, LocationRecord>>();
  for await (const group of readDataset(path)) {
    if (!timestamps.has(group.timestamp)) continue;
    const records = new Map<number, LocationRecord>();
    for (const record of group.records) if (!records.has(record.id)) records.set(record.id, record);
    byTimestamp.set(group.timestamp, records);
  }
  return byTimestamp;
}

const [outputPath, ...rest] = process.argv.slice(2);
const datasetPath = rest[0] === "--dataset" ? rest[1] : undefined;
if (outputPath === undefined || (rest.length > 0 && datasetPath === undefined)) {
  process.stderr.write("Usage: node dist/scripts/validate-output.js <output.json> [--dataset <dataset.txt>]\n");
  process.exitCode = 1;
} else {
  const text = await readFile(outputPath, "utf8");
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ file: outputPath, validJson: false, error: String(error) })}\n`);
    process.exit(1);
  }

  let lookup;
  if (datasetPath !== undefined && Array.isArray(document)) {
    const timestamps = new Set(document.map((item: { timestamp?: unknown }) => String(item?.timestamp)));
    const records = await datasetRecords(datasetPath, timestamps);
    lookup = (timestamp: string) => records.get(timestamp);
  }

  const result = validateOutput(document, lookup);
  process.stdout.write(
    `${JSON.stringify({
      file: outputPath,
      bytes: Buffer.byteLength(text),
      validJson: true,
      checkedAgainstDataset: datasetPath ?? null,
      ...result,
    })}\n`,
  );
  if (result.errorCount > 0) process.exitCode = 1;
}
