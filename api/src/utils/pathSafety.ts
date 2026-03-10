import path from "node:path";

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

export function safeResolveInsideRoot(rootDir: string, relativePath: string): string {
  const normalized = path.normalize(relativePath);
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, normalized);

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Path traversal attempt detected");
  }

  return resolvedTarget;
}
