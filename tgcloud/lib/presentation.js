import { t } from "./i18n.js";
import { decode } from "./media.js";
export function cleanText(value) {
  let text = String(value ?? "");
  for (let i = 0; i < 3; i++) {
    const next = decode(text).replace(
      /&(?:nbsp|apos|ndash|mdash|hellip|bull);/g,
      (m) =>
        ({
          "&nbsp;": " ",
          "&apos;": "'",
          "&ndash;": "–",
          "&mdash;": "—",
          "&hellip;": "…",
          "&bull;": "•",
        })[m],
    );
    if (next === text) break;
    text = next;
  }
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim();
}
export function username(value) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_]{1,32}$/.test(value.replace(/^@/, ""))
    ? value.replace(/^@/, "")
    : "";
}
export function mediaCaption({ title = "", author = "", source = "" }) {
  const text = cleanText(title).replace(
    /\s*[•|]\s*Instagram photos and videos\s*$/i,
    "",
  );
  const rawAuthor = cleanText(author).replace(/^@/, "");
  const handle = /^[a-zA-Z0-9_.]{1,64}$/.test(rawAuthor)
    ? rawAuthor
    : text.match(/@([a-zA-Z0-9_.]{1,64})/)?.[1];
  const heading = handle
    ? "@" + handle
    : ["Instagram", "Direct", "Telegram"].includes(text)
      ? ""
      : text.slice(0, 180);
  return [heading, source].filter(Boolean).join("\n").slice(0, 1024);
}
export function ownerCaption(
  { username: handle, userId, source },
  idLabel = "ID",
) {
  return [
    username(handle) ? "@" + username(handle) : "",
    `${idLabel}: ${userId}`,
    source,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 1024);
}
export function pagination(total, requested = 0, size = 5) {
  if (!Number.isSafeInteger(requested) || requested < 0)
    throw new Error("invalid page");
  const pages = Math.max(1, Math.ceil(total / size));
  const offset = Math.min(
    Math.floor(requested / size) * size,
    (pages - 1) * size,
  );
  const page = offset / size + 1;
  return {
    offset,
    page,
    pages,
    total,
    previous: offset ? offset - size : null,
    next: offset + size < total ? offset + size : null,
  };
}

export function activityPayload(raw) {
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    value = [];
  }
  if (Array.isArray(value)) return { username: "", files: value };
  return {
    username: username(value?.username),
    files: Array.isArray(value?.files) ? value.files : [],
  };
}
export function encodeActivity(files, handle = "") {
  return JSON.stringify({ version: 1, username: username(handle), files });
}

export function profileCaption(profile, lang = "en") {
  const lines = [cleanText(profile.name), "@" + profile.username];
  const number = (n) =>
    typeof n === "number"
      ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
      : String(n);
  const counts = [];
  for (const field of ["followers", "following", "posts"])
    if (profile[field] !== undefined)
      counts.push(t(lang, field) + ": " + number(profile[field]));
  if (counts.length) lines.push(counts.join(" · "));
  if (profile.isPrivate !== null && profile.isPrivate !== undefined)
    lines.push(t(lang, profile.isPrivate ? "privateProfile" : "publicProfile"));
  if (profile.bio) lines.push(cleanText(profile.bio).slice(0, 350));
  if (profile.photoWidth && profile.photoHeight)
    lines.push(
      t(lang, "sourceResolution", {
        width: profile.photoWidth,
        height: profile.photoHeight,
      }),
    );
  lines.push(profile.source);
  return lines.filter(Boolean).join("\n").slice(0, 1024);
}
