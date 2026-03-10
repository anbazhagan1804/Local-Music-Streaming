import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeResolveInsideRoot } from "../src/utils/pathSafety";

describe("safeResolveInsideRoot", () => {
  it("resolves valid relative paths", () => {
    const root = path.resolve("/music");
    const result = safeResolveInsideRoot(root, "artist/album/song.mp3");
    expect(result).toContain(path.join("music", "artist", "album", "song.mp3"));
  });

  it("rejects traversal attempts", () => {
    const root = path.resolve("/music");
    expect(() => safeResolveInsideRoot(root, "../secrets.txt")).toThrow(/traversal/i);
  });
});
