const ACCEPTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function isAcceptedImageMime(mime: string): boolean {
  return ACCEPTED_IMAGE_MIMES.has(mime);
}

export function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= max) return { width, height };

  const scale = max / longestEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}
