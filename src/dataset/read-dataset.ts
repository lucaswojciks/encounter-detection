import { once } from "node:events";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { DatasetError } from "./dataset-error.js";
import { groupByTimestamp } from "./group-by-timestamp.js";
import type { TimestampGroup } from "./types.js";

/**
 * Streams a dataset file and yields its records grouped by timestamp.
 * The file is read incrementally and closed when iteration ends, fails or is
 * stopped early by the consumer.
 */
export async function* readDataset(path: string): AsyncGenerator<TimestampGroup, void, undefined> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    yield* groupByTimestamp(lines, path);
  } catch (error) {
    if (isSystemError(error)) {
      throw new DatasetError(`cannot read file: ${error.message}`, { source: path }, { cause: error });
    }
    throw error;
  } finally {
    lines.close();
    if (!input.closed) {
      input.destroy();
      await once(input, "close");
    }
  }
}

function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}
