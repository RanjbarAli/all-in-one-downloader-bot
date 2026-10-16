import { choose, MediaError } from "./media.js";
export const MAX_ITEMS = 50;
export function groups(formats) {
  const main = formats.filter((f) => !f.preview);
  const candidates = main.length ? main : formats;
  const map = new Map();
  for (const f of candidates) {
    const key = f.itemId ?? (f.kind === "photo" ? f.url : "main");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  if (map.size > MAX_ITEMS) throw new MediaError("collectionLimit");
  return [...map.values()];
}
export function automaticSelection(formats, limit, preferred = "auto") {
  const items = groups(formats);
  if (!items.length || items.some((xs) => xs.every((f) => f.preview)))
    return null;
  // Alternatives belonging to one item are qualities, not extra carousel slides.
  if (
    items.some(
      (xs) =>
        xs.filter(
          (f) => !f.silent && !f.segmented && (!f.size || f.size <= limit),
        ).length !== 1,
    )
  )
    return null;
  return items.map((xs) => choose(xs, limit, preferred));
}
export function allSelection(formats, limit, preferred = "auto") {
  return groups(formats).map((xs) => {
    const best = choose(xs, limit, preferred);
    if (!best) throw new MediaError("noFormats");
    return best;
  });
}
