import { randomBytes } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const DEFAULT_FLUSH_BYTES = 64 * 1024;

export interface WriteJsonArrayOptions {
  /** Buffered text size that triggers a write to disk. */
  readonly flushBytes?: number;
}

/**
 * Writes `items` as a JSON array whose text is identical to
 * `JSON.stringify(list, null, 2)`, without holding the list in memory.
 *
 * The text goes to a temporary file in the destination directory, which is
 * renamed to `path` only after every item was written and the file was
 * flushed and closed. On any failure the temporary file is removed, so `path`
 * never holds a partial result and a previous file at `path` is kept.
 * Returns the number of items written.
 */
export async function writeJsonArray(
  items: Iterable<unknown> | AsyncIterable<unknown>,
  path: string,
  options: WriteJsonArrayOptions = {},
): Promise<number> {
  const flushBytes = options.flushBytes ?? DEFAULT_FLUSH_BYTES;
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const handle = await open(temporaryPath, "wx");

  let count = 0;
  try {
    let buffer = "";
    for await (const item of items) {
      buffer += (count === 0 ? "[\n  " : ",\n  ") + JSON.stringify(item, null, 2).replaceAll("\n", "\n  ");
      count++;
      if (buffer.length >= flushBytes) {
        await handle.writeFile(buffer, "utf8");
        buffer = "";
      }
    }
    buffer += count === 0 ? "[]" : "\n]";
    await handle.writeFile(buffer, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporaryPath, { force: true });
    throw error;
  }

  try {
    await handle.close();
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return count;
}
