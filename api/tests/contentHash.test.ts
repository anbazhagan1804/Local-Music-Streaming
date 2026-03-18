import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashFile } from "../src/utils/contentHash";

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempFiles.splice(0).map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch {
        // Best effort cleanup for temp files created during tests.
      }
    })
  );
});

describe("hashFile", () => {
  it("returns the same hash for identical files", async () => {
    const now = Date.now();
    const firstPath = path.join(os.tmpdir(), `musicstream-hash-a-${now}.txt`);
    const secondPath = path.join(os.tmpdir(), `musicstream-hash-b-${now}.txt`);
    tempFiles.push(firstPath, secondPath);

    await fs.writeFile(firstPath, "same-content");
    await fs.writeFile(secondPath, "same-content");

    const firstHash = await hashFile(firstPath);
    const secondHash = await hashFile(secondPath);

    expect(firstHash).toBe(secondHash);
  });
});
