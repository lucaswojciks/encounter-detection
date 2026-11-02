import { once } from "node:events";
import { createReadStream, type ReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";

import { DatasetChunkParser } from "./chunk-parser.js";
import { DatasetError } from "./dataset-error.js";
import { groupByTimestamp } from "./group-by-timestamp.js";
import type { TimestampGroup } from "./types.js";

/** Bytes read from the file at a time (spec 001, plan section 12). */
export const CHUNK_SIZE = 1024 * 1024;

/**
 * Streams a dataset file and yields its records grouped by timestamp.
 * The file is read incrementally, one chunk of `CHUNK_SIZE` bytes at a time,
 * and converted from its bytes by `DatasetChunkParser`. The next chunk is only
 * read when the consumer asks for a group that the chunks read so far do not
 * complete. The file is closed when iteration ends, fails or is stopped early
 * by the consumer.
 */
export async function* readDataset(path: string): AsyncGenerator<TimestampGroup, void, undefined> {
  const parser = new DatasetChunkParser(path);
  let file;
  try {
    file = await open(path, "r");
    // One buffer for every chunk: the parser copies what it keeps between chunks.
    const buffer = Buffer.allocUnsafe(CHUNK_SIZE);
    for (;;) {
      const { bytesRead } = await file.read(buffer, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) break;
      yield* parser.push(buffer.subarray(0, bytesRead));
    }
    yield* parser.end();
  } catch (error) {
    throw asDatasetError(error, path);
  } finally {
    await file?.close();
  }
}

/**
 * Reference reader, with the same result as `readDataset`: decodes the file as
 * text, splits it into lines with `readline` and converts each line with
 * `groupByTimestamp`. It was the implementation of `readDataset` until the byte
 * reader (spec 001, section 12), and is kept to validate it.
 */
export async function* readDatasetLines(path: string): AsyncGenerator<TimestampGroup, void, undefined> {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    yield* groupByTimestamp(lines, path);
  } catch (error) {
    throw asDatasetError(error, path);
  } finally {
    lines.close();
    await close(input);
  }
}

async function close(input: ReadStream): Promise<void> {
  if (!input.closed) {
    input.destroy();
    await once(input, "close");
  }
}

function asDatasetError(error: unknown, path: string): unknown {
  if (isSystemError(error)) {
    return new DatasetError(`cannot read file: ${error.message}`, { source: path }, { cause: error });
  }
  return error;
}

function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}
