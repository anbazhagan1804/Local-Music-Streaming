import { createHash } from "node:crypto";
import fs from "node:fs";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      callback();
    }
  });

  await pipeline(fs.createReadStream(filePath), sink);

  return hash.digest("hex");
}

export function createHashingPassThrough(): {
  stream: Transform;
  digest: () => string;
} {
  const hash = createHash("sha256");

  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    }
  });

  return {
    stream,
    digest: () => hash.digest("hex")
  };
}
