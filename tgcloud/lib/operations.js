import { db } from "sdk";
import { eq } from "sdk/db";
import { users, activity, locks } from "../schema.js";
import { OWNER_ID, PLATFORMS } from "./config.js";
import { MediaError } from "./media.js";
export const controlDefaults = {
  enabled: true,
  maxMiB: 25,
  bulk: 50,
  interval: 2,
  retention: 10000,
  recording: true,
  disabled: [],
};
export const controlChoices = {
  enabled: [true, false],
  maxMiB: [25, 10, 5],
  bulk: [50, 25, 10, 5],
  interval: [2, 5, 10, 30],
  retention: [10000, 5000, 1000, 100],
  recording: [true, false],
};
export function controls(value) {
  const c = { ...controlDefaults };
  for (const [key, choices] of Object.entries(controlChoices))
    if (choices.includes(value?.[key])) c[key] = value[key];
  c.disabled = Array.isArray(value?.disabled)
    ? [...new Set(value.disabled.filter((p) => PLATFORMS.includes(p)))]
    : [];
  return c;
}
export async function readControls(u) {
  if (u.id === OWNER_ID) return controls(u.prefs._controls);
  const owner = await db
    .select()
    .from(users)
    .where(eq(users.id, OWNER_ID))
    .get();
  try {
    return controls(JSON.parse(owner?.prefs || "{}")._controls);
  } catch {
    return controls();
  }
}
export function assertDownloads(u, platform) {
  const c = controls(u.controls);
  if (!c.enabled && u.id !== OWNER_ID) throw new MediaError("downloadsPaused");
  if (c.disabled.includes(platform)) throw new MediaError("sourceDisabled");
}
export function byteLimit(u) {
  return (
    Math.min(Number(u.prefs.limit) || 25, controls(u.controls).maxMiB, 25) *
    1048576
  );
}
export async function clearBotData() {
  const removed = {};
  for (const [key, table] of [
    ["activity", activity],
    ["locks", locks],
    ["users", users],
  ])
    removed[key] = (await db.delete(table).run()).rowsAffected;
  // Confirm logical deletion; service-side backups and delivered messages are not controlled by this API.
  const remaining = {};
  for (const [key, table] of [
    ["activity", activity],
    ["locks", locks],
    ["users", users],
  ])
    remaining[key] = await db.$count(table);
  if (Object.values(remaining).some((n) => n !== 0))
    throw new Error("Data clear incomplete");
  return { removed, remaining };
}
