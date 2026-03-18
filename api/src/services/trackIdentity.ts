export type TrackIdentityInput = {
  title?: string | null;
  artist?: string | null;
  duration?: number | null;
};

function normalizeText(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeDuration(duration: number | null | undefined): string {
  if (!duration || Number.isNaN(duration) || duration <= 0) {
    return "";
  }

  return String(Math.round(duration));
}

export function buildTrackIdentityKey(input: TrackIdentityInput): string | null {
  const title = normalizeText(input.title);
  const artist = normalizeText(input.artist);
  const duration = normalizeDuration(input.duration);

  if (!title || !artist || artist === "unknownartist") {
    return null;
  }

  return `${title}|${artist}|${duration}`;
}
