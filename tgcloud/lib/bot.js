import { api, db, InputFile } from "sdk";
import { eq, and, desc, asc, gt, lt, lte, sql } from "sdk/db";
import { users, activity, locks } from "../schema.js";
import { OWNER_ID, MAX_BYTES, PLATFORMS } from "./config.js";
import { t } from "./i18n.js";
import {
  cleanText,
  username,
  mediaCaption,
  ownerCaption,
  pagination,
  activityPayload,
  encodeActivity,
  profileCaption,
} from "./presentation.js";
import { automaticSelection, allSelection, MAX_ITEMS } from "./selection.js";
import {
  controls,
  controlChoices,
  readControls,
  assertDownloads,
  byteLimit,
  clearBotData,
} from "./operations.js";
import { extract, extractStories, request, bounded } from "./network.js";
import {
  safeURL,
  detect,
  profileURL,
  choose,
  filename,
  decode,
  MediaError,
} from "./media.js";
export const defaults = {
  quality: "auto",
  photoOriginal: true,
  limit: 25,
  mode: "view",
  metadata: true,
  history: true,
};
const button = (text, data) => ({ text, callback_data: data });
const parse = (s, f = {}) => {
  try {
    return JSON.parse(s);
  } catch {
    return f;
  }
};
export async function user(id, identity) {
  await db
    .insert(users)
    .values({ id })
    .onConflictDoNothing({ target: users.id })
    .run();
  const u = await db.select().from(users).where(eq(users.id, id)).get();
  u.prefs = { ...defaults, ...parse(u.prefs) };
  u.username = identity
    ? username(identity.username)
    : username(u.prefs._username);
  if (identity) {
    u.prefs._username = u.username;
    await db
      .update(users)
      .set({ prefs: JSON.stringify(u.prefs) })
      .where(eq(users.id, id))
      .run();
  }
  u.state = parse(u.state);
  return u;
}
async function save(u) {
  if (u.volatile) return;
  await db
    .update(users)
    .set({
      lang: u.lang,
      prefs: JSON.stringify({ ...u.prefs, _username: username(u.username) }),
      state: JSON.stringify(u.state),
    })
    .where(eq(users.id, u.id))
    .run();
}
const tr = (u, k, v) => t(u.lang, k, v);
const nav = (u, back = "menu") =>
  back === "menu"
    ? [button(tr(u, "menu"), "menu")]
    : [button(tr(u, "back"), "back:" + back), button(tr(u, "menu"), "menu")];
async function screen(u, text, rows = [], mid) {
  const p = {
    chat_id: u.id,
    text: cleanText(text).slice(0, 4000),
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: rows },
  };
  if (mid) {
    try {
      return await api.editMessageText({ ...p, message_id: mid });
    } catch (e) {
      if (e.code !== 400) throw e;
    }
  }
  return api.sendMessage(p);
}
const ownerRows = (u) => [
  [
    button(tr(u, "settings"), "settings"),
    button(tr(u, "history"), "history:0"),
  ],
  [
    button(tr(u, "ownerPanel"), "owner:home"),
    button(tr(u, "admin"), "admin:0"),
  ],
  [
    button(tr(u, "serviceStatus"), "owner:status"),
    button(tr(u, "stats"), "stats"),
  ],
  [button(tr(u, "quality"), "advanced"), button(tr(u, "language"), "language")],
];
export async function menu(u, mid) {
  if (u.volatile)
    return screen(
      u,
      tr(u, "volatileWelcome"),
      [
        ...(u.id === OWNER_ID ? ownerRows(u) : []),
        [button(tr(u, "help"), "help"), button(tr(u, "privacy"), "privacy")],
      ],
      mid,
    );
  const rows =
    u.id === OWNER_ID
      ? [
          [
            button(tr(u, "platforms"), "platforms"),
            button(tr(u, "help"), "help"),
          ],
          ...ownerRows(u),
        ]
      : [
          [
            button(tr(u, "platforms"), "platforms"),
            button(tr(u, "history"), "history:0"),
          ],
          [
            button(tr(u, "settings"), "settings"),
            button(tr(u, "help"), "help"),
          ],
        ];
  return screen(u, tr(u, "welcome"), rows, mid);
}
async function settings(u, mid) {
  return screen(
    u,
    tr(u, "settings"),
    [
      [button(tr(u, "language"), "language")],
      [button(tr(u, "mode") + ": " + tr(u, u.prefs.mode), "pref:mode")],
      [button(tr(u, "advanced"), "advanced")],
      nav(u),
    ],
    mid,
  );
}
async function advanced(u, mid) {
  const p = u.prefs;
  return screen(
    u,
    tr(u, "settings"),
    [
      [button(tr(u, "language"), "language")],
      [button(tr(u, "quality") + ": " + p.quality, "pref:quality")],
      [button(tr(u, "size") + ": " + p.limit + " MiB", "pref:limit")],
      [button(tr(u, "mode") + ": " + tr(u, p.mode), "pref:mode")],
      [
        button(
          tr(u, "metadata") + ": " + tr(u, p.metadata ? "on" : "off"),
          "pref:metadata",
        ),
      ],
      [
        button(
          tr(u, "keep") + ": " + tr(u, p.history ? "on" : "off"),
          "pref:history",
        ),
      ],
      [
        button(
          tr(u, "photoDelivery") +
            ": " +
            tr(u, p.photoOriginal ? "originalPhoto" : "photoPreview"),
          "pref:photoOriginal",
        ),
      ],
      [button(tr(u, "reset"), "reset")],
      nav(u),
    ],
    mid,
  );
}
export async function journal(u, source, platform, status, media = []) {
  if (u.volatile || !u.prefs.history || !controls(u.controls).recording)
    return null;
  const [a] = await db
    .insert(activity)
    .values({
      userId: u.id,
      source,
      platform,
      status,
      media: encodeActivity(media, u.username),
      created: Date.now(),
    })
    .returning()
    .run();
  await db.run(
    sql`DELETE FROM activity WHERE user_id=${u.id} AND id NOT IN (SELECT id FROM activity WHERE user_id=${u.id} ORDER BY id DESC LIMIT ${controls(u.controls).retention})`,
  );
  return a.id;
}
async function browse(u, admin, offset, mid, snapshot) {
  if (admin && u.id !== OWNER_ID) throw new MediaError("denied");
  const scope = admin ? sql`1=1` : eq(activity.userId, u.id);
  if (!snapshot) {
    const latest = await db
      .select()
      .from(activity)
      .where(scope)
      .orderBy(desc(activity.id))
      .limit(1)
      .get();
    snapshot = latest?.id || 0;
  }
  const filter = and(scope, lte(activity.id, snapshot));
  const total = await db.$count(activity, filter);
  const p = pagination(total, offset);
  const entries = await db
    .select()
    .from(activity)
    .where(filter)
    .orderBy(desc(activity.id))
    .offset(p.offset)
    .limit(5)
    .all();
  for (const a of entries) {
    a.username = activityPayload(a.media).username;
    if (admin && !a.username) {
      const cached = await db
        .select()
        .from(users)
        .where(eq(users.id, a.userId))
        .get();
      a.username = username(parse(cached?.prefs)._username);
    }
  }
  const kb = entries.map((a, i) => [
    button(
      `${p.offset + i + 1}. ${admin ? (username(a.username) ? "@" + username(a.username) : String(a.userId)) + " · " : ""}${a.platform} · ${tr(u, ["ready", "sent", "partial", "received"].includes(a.status) ? a.status : "errorStatus")}`,
      `${admin ? "av" : "hv"}:${a.id}:${snapshot}`,
    ),
  ]);
  const paging = [];
  if (p.previous !== null)
    paging.push(
      button(
        tr(u, "prevNumber", { n: p.page - 1, total: p.pages }),
        `${admin ? "admin" : "history"}:${p.previous}:${snapshot}`,
      ),
    );
  if (p.next !== null)
    paging.push(
      button(
        tr(u, "nextNumber", { n: p.page + 1, total: p.pages }),
        `${admin ? "admin" : "history"}:${p.next}:${snapshot}`,
      ),
    );
  if (paging.length) kb.push(paging);
  kb.push(
    admin
      ? [button(tr(u, "refresh"), "admin:0"), button(tr(u, "stats"), "stats")]
      : [button(tr(u, "clear"), "clear")],
    nav(u),
  );
  return screen(
    u,
    tr(u, admin ? "admin" : "history") +
      "\n" +
      tr(u, "pageSummary", { page: p.page, pages: p.pages, total }) +
      (total ? "" : "\n" + tr(u, "empty")),
    kb,
    mid,
  );
}
async function formats(u, mid, page = 0) {
  const s = u.state;
  if (!s.formats || Date.now() - s.time > 15 * 60000)
    throw new MediaError("expired");
  const rows = s.formats.slice(page * 8, page * 8 + 8).map((f, localIndex) => {
    const i = page * 8 + localIndex;
    const label = `${i + 1}. ${tr(u, f.preview ? "previewPhoto" : f.kind)}${f.kind === "video" && f.height ? " " + f.height + "p" : ""} · ${f.size ? (f.size / 1048576).toFixed(1) + " MiB" : tr(u, "unknown")}`;
    if (f.silent || f.segmented || f.size > byteLimit(u))
      return [{ text: label + " · " + tr(u, "unavailable"), url: s.source }];
    return [
      button(label, "get:" + s.time + ":" + i),
      button(
        (s.selected || []).includes(i) ? "✓" : tr(u, "selectItem"),
        "pick:" + s.time + ":" + i,
      ),
    ];
  });
  const pages = [];
  if (page > 0)
    pages.push(
      button(tr(u, "previousPage"), "fpage:" + s.time + ":" + (page - 1)),
    );
  if ((page + 1) * 8 < s.formats.length)
    pages.push(button(tr(u, "nextPage"), "fpage:" + s.time + ":" + (page + 1)));
  if (pages.length) rows.push(pages);
  rows.push([button(tr(u, "selected"), "get:" + s.time + ":selected")]);
  rows.push(
    [
      button(tr(u, "best"), "get:" + s.time + ":best"),
      button(tr(u, "all"), "get:" + s.time + ":all"),
    ],
    [{ text: tr(u, "source"), url: s.source }],
    nav(u),
  );
  return screen(u, decode(s.title) + "\n" + tr(u, "choose"), rows, mid);
}
export async function processURL(u, input) {
  const source = input.startsWith("https://")
    ? safeURL(input).url
    : profileURL(u.state.platform, input);
  assertDownloads(u, detect(source));
  const story = source.match(
    /^https:\/\/(?:www\.)?instagram\.com\/stories\/([a-zA-Z0-9_.]{1,30})\/(?:\d+\/?)?(?:\?[^#]*)?$/,
  );
  if (story) return sendStories(u, story[1]);
  const status = await screen(u, tr(u, "working"));
  let activityId;
  try {
    const result = await extract(source);
    activityId = await journal(u, source, result.platform, "ready");
    u.state = { ...result, source, time: Date.now(), activityId };
    await save(u);
    if (result.profile && !result.formats.length) {
      await screen(
        u,
        profileCaption(result.profile, u.lang) +
          "\n" +
          tr(u, "dpOriginalUnavailable"),
        profileButtons(u, result.profile),
        status.message_id,
      );
      return;
    }
    const automatic = automaticSelection(
      result.formats,
      byteLimit(u),
      u.prefs.quality,
    );
    if (u.volatile && !automatic && result.formats.every((f) => f.preview))
      throw new MediaError("unsupported");
    if (automatic || u.volatile) {
      await screen(
        u,
        tr(u, "sending", {
          n:
            automatic?.length ||
            allSelection(result.formats, byteLimit(u), u.prefs.quality).length,
        }),
        [],
        status.message_id,
      );
      await deliver(u, "all");
      try {
        await api.deleteMessage({
          chat_id: u.id,
          message_id: status.message_id,
        });
      } catch {}
    } else await formats(u, status.message_id);
  } catch (e) {
    await journal(u, source, u.state.platform || "Direct", e.code || "failed");
    throw e;
  }
}
function profileButtons(u, profile) {
  const rows = [];
  if (profile.isPrivate === false && profile.hasPublicStory !== false)
    rows.push([button(tr(u, "viewStories"), "stories:" + profile.username)]);
  rows.push([{ text: tr(u, "openProfile"), url: profile.source }]);
  return rows;
}
async function sendStories(u, name) {
  if (!/^[a-zA-Z0-9_.]{1,30}$/.test(name)) throw new MediaError("invalid");
  assertDownloads(u, "Instagram");
  const status = await screen(u, tr(u, "working"));
  try {
    const result = await extractStories(name);
    const activityId = await journal(u, result.source, "Instagram", "ready");
    u.state = { ...result, activityId, time: Date.now() };
    await save(u);
    await deliver(u, "all");
    try {
      await api.deleteMessage({ chat_id: u.id, message_id: status.message_id });
    } catch {}
  } catch (e) {
    await screen(
      u,
      tr(u, e instanceof MediaError ? e.code : "failed"),
      [
        [
          {
            text: tr(u, "openProfile"),
            url: "https://www.instagram.com/" + name + "/",
          },
        ],
        nav(u),
      ],
      status.message_id,
    );
  }
}
async function upload(u, f, options = {}) {
  const baseCaption =
    options.caption ??
    f.caption ??
    (u.state.profile
      ? profileCaption(u.state.profile, u.lang)
      : mediaCaption(u.state));
  const caption = cleanText(
    baseCaption + (u.volatile ? "\n" + tr(u, "notSaved") : ""),
  ).slice(0, 1024);
  const extra = {
    ...(options.forceCaption || u.prefs.metadata ? { caption } : {}),
    ...(options.keyboard
      ? { reply_markup: { inline_keyboard: options.keyboard } }
      : {}),
  };
  if (f.segmented || f.silent) throw new MediaError("unsupported");
  const limit = Math.min(MAX_BYTES, byteLimit(u));
  let file = f.fileId;
  let type = f.type || f.kind;
  // Verified native JPEG-to-document URL delivery preserves the source bytes.
  // It also avoids the platform's failing larger multipart upload path.
  if (
    !file &&
    f.kind === "photo" &&
    u.prefs.photoOriginal &&
    f.size > 0 &&
    f.size <= limit &&
    f.size <= 20 * 1000 * 1000
  ) {
    const head = await request(f.url, "HEAD");
    const mime = (head.headers.get("content-type") || "").split(";")[0];
    const size = Number(head.headers.get("content-length"));
    const url = head.url || f.url;
    safeURL(url);
    if (
      mime === "image/jpeg" &&
      size > 0 &&
      size <= limit &&
      size <= 20 * 1000 * 1000
    ) {
      try {
        const m = await api.sendDocument({
          chat_id: u.id,
          document: url,
          disable_content_type_detection: true,
          ...extra,
        });
        return {
          fileId: m.document.file_id,
          type: "document",
          kind: "photo",
          label: f.label || "Photo",
          caption,
          size: m.document.file_size,
        };
      } catch (e) {
        if (e.code !== 400) throw e;
      }
    }
  }
  if (
    !file &&
    u.prefs.mode === "view" &&
    !(f.kind === "photo" && u.prefs.photoOriginal) &&
    f.size > 0 &&
    f.size <= limit &&
    f.size <= (type === "photo" ? 5 : 20) * 1000 * 1000 &&
    ["photo", "video", "audio"].includes(type)
  ) {
    const head = await request(f.url, "HEAD");
    const mime = head.headers.get("content-type") || "";
    const actualSize = Number(head.headers.get("content-length"));
    const finalURL = head.url || f.url;
    safeURL(finalURL);
    if (
      actualSize > 0 &&
      actualSize <= limit &&
      actualSize <= (type === "photo" ? 5 : 20) * 1000 * 1000 &&
      ((type === "video" && mime.startsWith("video/mp4")) ||
        (type === "photo" && /^image\/(jpeg|png|webp)/.test(mime)) ||
        (type === "audio" && /^audio\/(mpeg|mp4)/.test(mime)))
    ) {
      try {
        const method = {
          photo: "sendPhoto",
          video: "sendVideo",
          audio: "sendAudio",
        }[type];
        const m = await api[method]({
          chat_id: u.id,
          [type]: finalURL,
          ...extra,
        });
        const item = type === "photo" ? m.photo.slice(-1)[0] : m[type];
        return {
          fileId: item.file_id,
          type,
          kind: f.kind,
          label: f.label || type,
          caption,
          size: item.file_size,
          width: item.width,
          height: item.height,
        };
      } catch (e) {
        if (e.code !== 400) throw e;
      }
    }
  }
  if (!file) {
    const r = await request(f.url);
    const mime = (r.headers.get("content-type") || "").split(";")[0];
    if (!/^(image|video|audio)\//.test(mime))
      throw new MediaError("unsupported");
    if (f.size > limit) throw new MediaError("large");
    const bytes = await bounded(r, limit);
    file = new InputFile(bytes, filename(f.url, f.kind, mime), { type: mime });
    if (
      u.prefs.mode === "document" ||
      (f.kind === "photo" && u.prefs.photoOriginal) ||
      (f.kind === "photo" && bytes.length > 10 * 1024 * 1024)
    )
      type = "document";
    if (mime === "video/webm" || mime === "image/gif") type = "document";
  }
  const method = {
    photo: "sendPhoto",
    video: "sendVideo",
    audio: "sendAudio",
    document: "sendDocument",
    animation: "sendAnimation",
    voice: "sendVoice",
    video_note: "sendVideoNote",
    sticker: "sendSticker",
  }[type];
  if (!method) throw new MediaError("unsupported");
  const message = await api[method]({
    chat_id: u.id,
    [type]: file,
    ...(!["sticker", "video_note"].includes(type)
      ? extra
      : options.keyboard
        ? { reply_markup: { inline_keyboard: options.keyboard } }
        : {}),
  });
  const item = type === "photo" ? message.photo?.slice(-1)[0] : message[type];
  return {
    fileId: item.file_id,
    type,
    kind: f.kind,
    label: f.label || type,
    caption,
    size: item.file_size,
    width: item.width,
    height: item.height,
  };
}
async function deliver(u, key) {
  assertDownloads(u, u.state.platform);
  if (!u.state.formats || Date.now() - u.state.time > 15 * 60000)
    throw new MediaError("expired");
  let progress;
  if (key === "resume") {
    progress = u.state.delivery;
    if (!progress || progress.next >= progress.indices.length)
      throw new MediaError("expired");
  } else {
    let fs;
    if (key === "best") {
      if (u.state.collection)
        fs = allSelection(u.state.formats, byteLimit(u), u.prefs.quality);
      else {
        const f = choose(u.state.formats, byteLimit(u), u.prefs.quality);
        if (!f) throw new MediaError("noFormats");
        fs = [f];
      }
    } else if (key === "selected") {
      fs = (u.state.selected || [])
        .map((i) => u.state.formats[i])
        .filter(Boolean);
    } else if (key === "all")
      fs = allSelection(u.state.formats, byteLimit(u), u.prefs.quality);
    else {
      const i = Number(key);
      if (!Number.isSafeInteger(i) || !u.state.formats[i])
        throw new MediaError("invalid");
      fs = [u.state.formats[i]];
    }
    if (!fs.length) throw new MediaError("noFormats");
    if (fs.length > controls(u.controls).bulk)
      throw new MediaError("bulkLimit");
    progress = { indices: fs.map((f) => u.state.formats.indexOf(f)), next: 0 };
    u.state.delivery = progress;
    await save(u);
  }
  if (progress.indices.length > controls(u.controls).bulk)
    throw new MediaError("bulkLimit");
  const started = Date.now();
  while (progress.next < progress.indices.length) {
    const f = u.state.formats[progress.indices[progress.next]];
    try {
      const keyboard = [];
      const profile = u.state.profile;
      if (profile && progress.next === progress.indices.length - 1)
        keyboard.push(...profileButtons(u, profile));
      const sent = await upload(u, f, keyboard.length ? { keyboard } : {});
      progress.next++;
      await save(u);
      if (u.state.activityId) {
        const row = await db
          .select()
          .from(activity)
          .where(
            and(eq(activity.id, u.state.activityId), eq(activity.userId, u.id)),
          )
          .get();
        if (row)
          await db
            .update(activity)
            .set({
              media: encodeActivity(
                [...activityPayload(row.media).files, sent].slice(-MAX_ITEMS),
                activityPayload(row.media).username || u.username,
              ),
              status:
                progress.next === progress.indices.length ? "sent" : "partial",
            })
            .where(eq(activity.id, row.id))
            .run();
      }
    } catch (e) {
      await screen(
        u,
        tr(u, e instanceof MediaError ? e.code : "failed") +
          "\n" +
          tr(u, "deliveryProgress", {
            sent: progress.next,
            total: progress.indices.length,
          }),
        [
          [
            ...(u.volatile
              ? []
              : [
                  button(
                    tr(u, "continueCollection"),
                    "get:" + u.state.time + ":resume",
                  ),
                ]),
          ],
          [{ text: tr(u, "source"), url: u.state.source }],
          nav(u),
        ],
      );
      return;
    }
    // Yield a resumable cursor before exhausting an unverified runtime budget.
    if (
      Date.now() - started > 20000 &&
      progress.next < progress.indices.length
    ) {
      if (u.volatile) {
        await screen(
          u,
          tr(u, "volatilePartial", {
            sent: progress.next,
            total: progress.indices.length,
          }),
          [[{ text: tr(u, "source"), url: u.state.source }], nav(u)],
        );
        return;
      }
      await screen(
        u,
        tr(u, "deliveryProgress", {
          sent: progress.next,
          total: progress.indices.length,
        }),
        [
          [
            ...(u.volatile
              ? []
              : [
                  button(
                    tr(u, "continueCollection"),
                    "get:" + u.state.time + ":resume",
                  ),
                ]),
          ],
          nav(u),
        ],
      );
      return;
    }
  }
  return { completed: true, total: progress.next };
}
async function entry(u, id, admin, snapshot) {
  if (admin && u.id !== OWNER_ID) throw new MediaError("denied");
  const row = await db
    .select()
    .from(activity)
    .where(
      and(eq(activity.id, id), admin ? sql`1=1` : eq(activity.userId, u.id)),
    )
    .get();
  if (!row) throw new MediaError("expired");
  const payload = activityPayload(row.media);
  const files = payload.files;
  row.username = payload.username;
  let caption = mediaCaption({ source: row.source, title: row.platform });
  const controls = [];
  if (admin) {
    if (!row.username) {
      const person = await db
        .select()
        .from(users)
        .where(eq(users.id, row.userId))
        .get();
      row.username = username(parse(person?.prefs)._username);
      if (!row.username) {
        try {
          const chat = await api.getChat({ chat_id: row.userId });
          row.username = username(chat.username);
          if (row.username) {
            await db
              .update(users)
              .set({
                prefs: JSON.stringify({
                  ...parse(person?.prefs),
                  _username: row.username,
                }),
              })
              .where(eq(users.id, row.userId))
              .run();
            await db
              .update(activity)
              .set({ media: encodeActivity(files, row.username) })
              .where(eq(activity.id, row.id))
              .run();
          }
        } catch {}
      }
    }
    caption = ownerCaption(row, tr(u, "userId"));
    if (!snapshot) {
      const latest = await db
        .select()
        .from(activity)
        .orderBy(desc(activity.id))
        .limit(1)
        .get();
      snapshot = latest?.id || row.id;
    }
    const total = await db.$count(activity, lte(activity.id, snapshot));
    const position =
      1 +
      (await db.$count(
        activity,
        and(gt(activity.id, row.id), lte(activity.id, snapshot)),
      ));
    const previous = await db
      .select()
      .from(activity)
      .where(and(gt(activity.id, row.id), lte(activity.id, snapshot)))
      .orderBy(asc(activity.id))
      .limit(1)
      .get();
    const next = await db
      .select()
      .from(activity)
      .where(lt(activity.id, row.id))
      .orderBy(desc(activity.id))
      .limit(1)
      .get();
    const buttons = [];
    if (previous)
      buttons.push(
        button(
          tr(u, "prevNumber", { n: position - 1, total }),
          `av:${previous.id}:${snapshot}`,
        ),
      );
    if (next)
      buttons.push(
        button(
          tr(u, "nextNumber", { n: position + 1, total }),
          `av:${next.id}:${snapshot}`,
        ),
      );
    if (buttons.length) controls.push(buttons);
    controls.push([
      button(
        tr(u, "activityList"),
        "admin:" + Math.floor((position - 1) / 5) * 5 + ":" + snapshot,
      ),
    ]);
  } else {
    if (row.source.startsWith("https://"))
      controls.push([button(tr(u, "repeat"), "repeat:" + row.id)]);
    controls.push([
      button(tr(u, "delete"), "delete:" + row.id),
      button(tr(u, "back"), "history:0"),
    ]);
  }
  if (!files.length)
    return screen(u, caption + "\n" + tr(u, row.status), controls);
  for (let i = 0; i < files.length && i < MAX_ITEMS; i++)
    await upload(u, files[i], {
      caption: admin ? caption : files[i].caption || caption,
      forceCaption: admin,
      ...(i === Math.min(files.length, MAX_ITEMS) - 1
        ? { keyboard: controls }
        : {}),
    });
}
async function ownerPanel(u, action = "home", value, mid) {
  if (u.id !== OWNER_ID) throw new MediaError("denied");
  if (action === "status") {
    let storage = "on";
    try {
      await db.get(sql`SELECT 1 AS n`);
    } catch {
      storage = "off";
    }
    const c = controls(u.controls);
    return screen(
      u,
      tr(u, "serviceStatus") +
        "\n" +
        tr(u, "storage") +
        ": " +
        tr(u, storage) +
        "\n" +
        tr(u, "globalSize") +
        ": " +
        c.maxMiB +
        " MiB\n" +
        tr(u, "bulkSize") +
        ": " +
        c.bulk +
        "\n" +
        tr(u, "profileFloor") +
        "\n" +
        tr(u, "storyAccess"),
      [
        [button(tr(u, "refresh"), "owner:status")],
        [button(tr(u, "ownerPanel"), "owner:home")],
        nav(u),
      ],
      mid,
    );
  }
  if (u.volatile)
    return screen(
      u,
      tr(u, "ownerPanel") + "\n" + tr(u, "storageUnavailable"),
      [[button(tr(u, "serviceStatus"), "owner:status")], nav(u)],
      mid,
    );
  const c = controls(u.controls || u.prefs._controls);
  if (action === "purge")
    return screen(
      u,
      tr(u, "purgeWarning"),
      [
        [button(tr(u, "purgeConfirm"), "owner:purge_yes")],
        [button(tr(u, "back"), "owner:home")],
      ],
      mid,
    );
  if (action === "purge_yes") {
    await clearBotData();
    u.state = {};
    u.prefs = { ...defaults };
    u.controls = controls();
    u.lang = "en";
    // No save here: a reset must leave every table empty.
    return screen(u, tr(u, "dataCleared"), [nav(u)], mid);
  }
  if (action === "source") {
    if (!PLATFORMS.includes(value)) throw new MediaError("invalid");
    c.disabled = c.disabled.includes(value)
      ? c.disabled.filter((p) => p !== value)
      : [...c.disabled, value];
  } else if (controlChoices[action]) {
    const choices = controlChoices[action];
    c[action] = choices[(choices.indexOf(c[action]) + 1) % choices.length];
  } else if (!["home", "sources"].includes(action))
    throw new MediaError("invalid");
  if (action !== "home" && action !== "sources") {
    u.controls = c;
    u.prefs._controls = c;
    await save(u);
  }
  if (action === "sources" || action === "source")
    return screen(
      u,
      tr(u, "sourcesControl"),
      [
        ...PLATFORMS.map((p) => [
          button(
            (c.disabled.includes(p) ? "○ " : "✓ ") + p,
            "owner:source:" + p,
          ),
        ]),
        [button(tr(u, "back"), "owner:home")],
      ],
      mid,
    );
  const row = (key, label, display) => [
    button(tr(u, label) + ": " + display, "owner:" + key),
  ];
  return screen(
    u,
    tr(u, "ownerPanel"),
    [
      [button(tr(u, "admin"), "admin:0"), button(tr(u, "stats"), "stats")],
      row("enabled", "publicDownloads", tr(u, c.enabled ? "on" : "off")),
      row("maxMiB", "globalSize", c.maxMiB + " MiB"),
      row("bulk", "bulkSize", String(c.bulk)),
      row("interval", "requestInterval", c.interval + " s"),
      row("retention", "retention", String(c.retention)),
      row("recording", "globalHistory", tr(u, c.recording ? "on" : "off")),
      [button(tr(u, "sourcesControl"), "owner:sources")],
      [
        button(tr(u, "settings"), "settings"),
        button(tr(u, "serviceStatus"), "owner:status"),
      ],
      [button(tr(u, "purgeData"), "owner:purge")],
      nav(u),
    ],
    mid,
  );
}
export async function dispatch(u, data, mid) {
  const [action, arg, extra] = data.split(":");
  if (
    u.volatile &&
    ![
      "menu",
      "cancel",
      "help",
      "privacy",
      "back",
      "stories",
      "owner",
      "admin",
      "stats",
      "settings",
      "history",
      "advanced",
      "language",
    ].includes(action)
  )
    return screen(u, tr(u, "serviceUnavailable"), [nav(u)], mid);
  if (action === "owner") return ownerPanel(u, arg, extra, mid);
  if (
    u.volatile &&
    ["admin", "stats", "settings", "history", "advanced", "language"].includes(
      action,
    )
  )
    return ownerPanel(u, "home", undefined, mid);
  if (action === "stories") return sendStories(u, arg);
  if (action === "back") return dispatch(u, arg || "menu", mid);
  if (action === "menu" || action === "cancel") {
    u.state = {};
    await save(u);
    return menu(u, mid);
  }
  if (action === "platforms")
    return screen(
      u,
      tr(u, "select"),
      [
        ...PLATFORMS.filter(
          (p) => !controls(u.controls).disabled.includes(p),
        ).map((p) => [button(p, "platform:" + p)]),
        nav(u),
      ],
      mid,
    );
  if (action === "platform") {
    if (!PLATFORMS.includes(arg)) throw new MediaError("invalid");
    u.state = { platform: arg };
    await save(u);
    return screen(u, tr(u, "input", { p: arg }), [nav(u, "platforms")], mid);
  }
  if (action === "settings") return settings(u, mid);
  if (action === "advanced") return advanced(u, mid);
  if (action === "language")
    return screen(
      u,
      tr(u, "language"),
      [
        ["English", "en"],
        ["فارسی", "fa"],
        ["العربية", "ar"],
      ]
        .map(([n, l]) => [button(n, "lang:" + l)])
        .concat([nav(u, "settings")]),
      mid,
    );
  if (action === "lang") {
    if (!["en", "fa", "ar"].includes(arg)) throw new MediaError("invalid");
    u.lang = arg;
    await save(u);
    return settings(u, mid);
  }
  if (action === "pref") {
    const p = u.prefs;
    if (arg === "quality") {
      const opts = ["auto", "1080", "720", "480", "360"];
      p.quality = opts[(opts.indexOf(p.quality) + 1) % opts.length];
    } else if (arg === "limit")
      p.limit = { 25: 10, 10: 5, 5: 25 }[p.limit] || 25;
    else if (arg === "mode") p.mode = p.mode === "view" ? "document" : "view";
    else if (["metadata", "history", "photoOriginal"].includes(arg))
      p[arg] = !p[arg];
    else throw new MediaError("invalid");
    await save(u);
    return arg === "mode" ? settings(u, mid) : advanced(u, mid);
  }
  if (action === "reset") {
    u.prefs = {
      ...defaults,
      ...(u.prefs._controls ? { _controls: u.prefs._controls } : {}),
    };
    await save(u);
    return settings(u, mid);
  }
  if (["privacy", "help"].includes(action))
    return screen(
      u,
      tr(u, action + "Text"),
      [
        ...(action === "help" ? [[button(tr(u, "privacy"), "privacy")]] : []),
        nav(u),
      ],
      mid,
    );
  if (action === "history" || action === "admin") {
    const n = Number(arg);
    if (!Number.isSafeInteger(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)
      throw new MediaError("invalid");
    const snapshot = extra === undefined ? undefined : Number(extra);
    if (
      snapshot !== undefined &&
      (!Number.isSafeInteger(snapshot) || snapshot < 0)
    )
      throw new MediaError("invalid");
    return browse(u, action === "admin", n, mid, snapshot);
  }
  if (action === "clear") {
    await db.delete(activity).where(eq(activity.userId, u.id)).run();
    u.state = {};
    await save(u);
    return browse(u, false, 0, mid);
  }
  if (action === "delete") {
    await db
      .delete(activity)
      .where(and(eq(activity.id, Number(arg)), eq(activity.userId, u.id)))
      .run();
    if (u.state.activityId === Number(arg)) {
      u.state = {};
      await save(u);
    }
    return browse(u, false, 0, mid);
  }
  if (action === "av" || action === "hv") {
    if (
      !Number.isSafeInteger(Number(arg)) ||
      Number(arg) < 1 ||
      (extra !== undefined &&
        (!Number.isSafeInteger(Number(extra)) || Number(extra) < 1))
    )
      throw new MediaError("invalid");
    return entry(
      u,
      Number(arg),
      action === "av",
      extra === undefined ? undefined : Number(extra),
    );
  }
  if (action === "repeat") {
    const a = await db
      .select()
      .from(activity)
      .where(and(eq(activity.id, Number(arg)), eq(activity.userId, u.id)))
      .get();
    if (!a) throw new MediaError("expired");
    const cached = activityPayload(a.media).files;
    if (
      cached.length &&
      !(
        u.prefs.photoOriginal &&
        cached.some((f) => f.kind === "photo" && f.type !== "document")
      )
    )
      return entry(u, a.id, false);
    return processURL(u, a.source);
  }
  if (action === "fpage") {
    const page = Number(extra);
    if (
      String(u.state.time) !== arg ||
      !Number.isSafeInteger(page) ||
      page < 0 ||
      !u.state.formats ||
      page * 8 >= u.state.formats.length
    )
      throw new MediaError("expired");
    return formats(u, mid, page);
  }
  if (action === "pick") {
    const i = Number(extra);
    if (
      String(u.state.time) !== arg ||
      !Number.isSafeInteger(i) ||
      !u.state.formats?.[i] ||
      Date.now() - u.state.time > 15 * 60000
    )
      throw new MediaError("expired");
    const selected = u.state.selected || [];
    const item = u.state.formats[i].itemId;
    u.state.selected = selected.includes(i)
      ? selected.filter((x) => x !== i)
      : [
          ...selected.filter(
            (x) => item === undefined || u.state.formats[x]?.itemId !== item,
          ),
          i,
        ].slice(-MAX_ITEMS);
    await save(u);
    return formats(u, mid, Math.floor(i / 8));
  }
  if (action === "get") {
    if (String(u.state.time) !== arg) throw new MediaError("expired");
    return deliver(u, extra);
  }
  if (action === "stats") {
    if (u.id !== OWNER_ID) throw new MediaError("denied");
    const stats = await db.all(
      sql`SELECT platform,status,count(*) AS total FROM activity GROUP BY platform,status LIMIT 60`,
    );
    return screen(
      u,
      tr(u, "stats") +
        "\n" +
        stats
          .map((s) => `${s.platform} · ${tr(u, s.status)}: ${s.total}`)
          .join("\n"),
      [nav(u)],
      mid,
    );
  }
  throw new MediaError("invalid");
}
export async function guarded(id, work, identity, options = {}) {
  const now = Date.now();
  let held = false;
  let startedWork = false;
  try {
    const result = await db.run(
      sql`INSERT INTO locks (id,until) VALUES (${id},${now + 120000}) ON CONFLICT(id) DO UPDATE SET until=${now + 120000} WHERE locks.until<${now}`,
    );
    if (!result.rowsAffected) {
      await api.sendMessage({ chat_id: id, text: t("en", "busy") });
      return;
    }
    held = true;
    const u = await user(id, identity);
    u.controls = await readControls(u);
    if (now - u.last < u.controls.interval * 1000) {
      await screen(u, tr(u, "rate"), [nav(u)]);
      return;
    }
    await db.update(users).set({ last: now }).where(eq(users.id, id)).run();
    try {
      startedWork = true;
      await work(u);
    } catch (e) {
      await screen(u, tr(u, e instanceof MediaError ? e.code : "failed"), [
        nav(u),
      ]);
    }
  } catch {
    if (!startedWork && options.allowStateless && id === OWNER_ID) {
      const temporary = {
        id,
        username: username(identity?.username),
        lang: "en",
        prefs: { ...defaults, history: false },
        controls: controls(),
        state: {},
        volatile: true,
      };
      try {
        await work(temporary);
      } catch (e) {
        await screen(
          temporary,
          tr(temporary, e instanceof MediaError ? e.code : "failed"),
          [nav(temporary)],
        );
      }
    } else
      await api.sendMessage({
        chat_id: id,
        text: t("en", "serviceUnavailable"),
      });
  } finally {
    if (held) {
      try {
        await db.delete(locks).where(eq(locks.id, id)).run();
      } catch {}
    }
  }
}
export async function receive(u, m) {
  const command = (m.text || "").split(/\s/)[0].split("@")[0].slice(1);
  if (m.text?.startsWith("/")) {
    if (command === "start") {
      return menu(u);
    }
    const map = {
      menu: "menu",
      platforms: "platforms",
      settings: "settings",
      language: "language",
      history: "history:0",
      help: "help",
      privacy: "privacy",
      cancel: "cancel",
      admin: "admin:0",
    };
    return dispatch(u, map[command] || "help");
  }
  const media =
    m.video ||
    m.document ||
    m.audio ||
    m.animation ||
    m.voice ||
    m.video_note ||
    m.sticker ||
    m.photo?.slice(-1)[0];
  if (media) {
    const kind = m.video
      ? "video"
      : m.photo
        ? "photo"
        : m.audio
          ? "audio"
          : m.animation
            ? "animation"
            : m.voice
              ? "voice"
              : m.video_note
                ? "video_note"
                : m.sticker
                  ? "sticker"
                  : "document";
    await journal(u, "Telegram media", "Telegram", "received", [
      {
        fileId: media.file_id,
        type: kind,
        kind,
        size: media.file_size,
        label: kind,
      },
    ]);
    return screen(u, tr(u, "done"), [nav(u)]);
  }
  return processURL(u, (m.text || "").trim());
}
