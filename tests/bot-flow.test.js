import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { sdkSource, dbSource, mockCloud } from "./helpers/cloud-mock.js";
registerHooks({
  resolve(specifier, ctx, next) {
    if (specifier === "sdk" || specifier === "sdk/db")
      return { url: "mock:" + specifier, shortCircuit: true };
    return next(specifier, ctx);
  },
  load(url, ctx, next) {
    if (url === "mock:sdk" || url === "mock:sdk/db")
      return {
        format: "module",
        source: url === "mock:sdk" ? sdkSource : dbSource,
        shortCircuit: true,
      };
    return next(url, ctx);
  },
});
const { processURL, dispatch, defaults } = await import(
  "../tgcloud/lib/bot.js"
);
const source = "https://www.instagram.com/p/POST/";
function post(count) {
  return (
    '"shortcode_media":' +
    JSON.stringify({
      shortcode: "POST",
      edge_sidecar_to_children: {
        edges: Array.from({ length: count }, (_, i) => ({
          node: {
            id: String(i),
            display_url: `https://a.cdninstagram.com/${i}-full.jpg`,
          },
        })),
      },
    })
  );
}
function setup(html) {
  globalThis.cloudMock = mockCloud(html);
  return {
    id: 792399936,
    lang: "en",
    prefs: { ...defaults, photoOriginal: false },
    state: {},
  };
}
test("single original image is sent automatically without a quality prompt", async () => {
  const u = setup(
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg">',
  );
  await processURL(u, source);
  assert.equal(cloudMock.media.length, 1);
  assert.equal(cloudMock.media[0].value, "https://a.cdninstagram.com/full.jpg");
  assert.equal(u.state.delivery.next, 1);
  assert.equal(
    cloudMock.calls.some((c) =>
      c.params.reply_markup?.inline_keyboard
        .flat()
        .some((b) => b.callback_data?.startsWith("get:")),
    ),
    false,
  );
  assert.equal(JSON.parse(cloudMock.records.activity[0].media).files.length, 1);
});
test("all twelve carousel images are verified, sent in order, retained and replayed", async () => {
  const u = setup(post(12));
  await processURL(u, source);
  assert.deepEqual(
    cloudMock.media.map((x) => x.value),
    Array.from(
      { length: 12 },
      (_, i) => `https://a.cdninstagram.com/${i}-full.jpg`,
    ),
  );
  assert.equal(u.state.delivery.next, 12);
  assert.equal(cloudMock.records.activity[0].status, "sent");
  assert.equal(
    JSON.parse(cloudMock.records.activity[0].media).files.length,
    12,
  );
  await dispatch(u, "hv:1");
  assert.equal(cloudMock.media.length, 24);
  assert.ok(
    cloudMock.media
      .slice(12)
      .every((x) => String(x.value).startsWith("cached-")),
  );
});
test("real qualities still prompt; download all uses all items rather than visible selection page", async () => {
  const first = {
    id: "v",
    is_video: true,
    video_versions: [
      { url: "https://a.cdninstagram.com/720.mp4", height: 720 },
      { url: "https://a.cdninstagram.com/360.mp4", height: 360 },
    ],
  };
  const node = {
    shortcode: "POST",
    carousel_media: [
      first,
      ...Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        display_url: `https://a.cdninstagram.com/${i}.jpg`,
      })),
    ],
  };
  const u = setup('"shortcode_media":' + JSON.stringify(node));
  await processURL(u, source);
  assert.equal(cloudMock.media.length, 0);
  assert.ok(
    cloudMock.calls.some((c) =>
      c.params.reply_markup?.inline_keyboard
        .flat()
        .some((b) => b.callback_data?.startsWith("fpage:")),
    ),
  );
  await dispatch(u, "fpage:" + u.state.time + ":1", 2);
  await dispatch(u, "get:" + u.state.time + ":all");
  assert.equal(cloudMock.media.length, 11);
  assert.equal(cloudMock.media[0].value, "https://a.cdninstagram.com/720.mp4");
});
test("failed collection resumes from the remaining slide without resending completed media", async () => {
  const u = setup(post(5));
  cloudMock.failOnce = "https://a.cdninstagram.com/1-full.jpg";
  await processURL(u, source);
  assert.equal(cloudMock.media.length, 1);
  assert.equal(u.state.delivery.next, 1);
  await dispatch(u, "get:" + u.state.time + ":resume");
  assert.equal(cloudMock.media.length, 5);
  assert.equal(u.state.delivery.next, 5);
  assert.equal(
    cloudMock.attempts.filter(
      (x) => x === "https://a.cdninstagram.com/0-full.jpg",
    ).length,
    1,
  );
  assert.equal(JSON.parse(cloudMock.records.activity[0].media).files.length, 5);
});
test("a cropped-only Instagram post is never auto-delivered as the original", async () => {
  const u = setup(
    '<meta property="og:image" content="https://a.cdninstagram.com/cropped.jpg">',
  );
  await assert.rejects(processURL(u, source), { code: "originalUnavailable" });
  assert.equal(cloudMock.media.length, 0);
});

test("owner activity has counted Next/Prev pages across thousands of entries and a stable snapshot", async () => {
  const u = setup("");
  for (let id = 1; id <= 10003; id++)
    cloudMock.records.activity.push({
      id,
      userId: 100 + id,
      username: "person" + id,
      platform: "Instagram",
      source: "https://www.instagram.com/p/POST/",
      status: "sent",
      media: JSON.stringify({ version: 1, username: "person" + id, files: [] }),
    });
  await dispatch(u, "admin:0");
  const first = cloudMock.calls.at(-1).params;
  assert.ok(first.text.includes("Page 1/2001 · 10003 requests"));
  const next = first.reply_markup.inline_keyboard
    .flat()
    .find((b) => b.text.startsWith("Next"));
  assert.equal(next.text, "Next 2/2001");
  assert.equal(next.callback_data, "admin:5:10003");
  cloudMock.records.activity.push({
    id: 10004,
    userId: 1,
    username: "new",
    platform: "Direct",
    source: "https://w3.org/a.jpg",
    status: "sent",
    media: JSON.stringify({ version: 1, username: "new", files: [] }),
  });
  await dispatch(u, next.callback_data);
  const second = cloudMock.calls.at(-1).params;
  assert.ok(second.text.includes("Page 2/2001 · 10003 requests"));
  assert.equal(
    second.reply_markup.inline_keyboard[0][0].callback_data,
    "av:9998:10003",
  );
  assert.ok(
    second.reply_markup.inline_keyboard
      .flat()
      .some((b) => b.text === "Prev 1/2001"),
  );
  await dispatch(u, "admin:10000:10003");
  const last = cloudMock.calls.at(-1).params;
  assert.ok(last.text.includes("Page 2001/2001"));
  assert.equal(
    last.reply_markup.inline_keyboard
      .flat()
      .some((b) => b.text.startsWith("Next")),
    false,
  );
});
test("owner media caption and per-request numbered navigation appear on the media itself", async () => {
  const u = setup("");
  for (let id = 1; id <= 7; id++)
    cloudMock.records.activity.push({
      id,
      userId: 100 + id,
      username: "person" + id,
      platform: "Instagram",
      source: "https://www.instagram.com/p/POST" + id + "/",
      status: "sent",
      media: JSON.stringify({
        version: 1,
        username: "person" + id,
        files: [{ fileId: "file-" + id, type: "photo", kind: "photo" }],
      }),
    });
  await dispatch(u, "av:7:7");
  let p = cloudMock.calls.at(-1).params;
  assert.equal(
    p.caption,
    "@person7\nUser ID: 107\nhttps://www.instagram.com/p/POST7/",
  );
  const next = p.reply_markup.inline_keyboard
    .flat()
    .find((b) => b.text.startsWith("Next"));
  assert.equal(next.text, "Next 2/7");
  assert.equal(next.callback_data, "av:6:7");
  await dispatch(u, next.callback_data);
  p = cloudMock.calls.at(-1).params;
  assert.ok(p.caption.startsWith("@person6\n"));
  assert.ok(
    p.reply_markup.inline_keyboard.flat().some((b) => b.text === "Prev 1/7"),
  );
});
test("owner activity and media remain inaccessible to another account", async () => {
  const u = setup("");
  u.id = 12345;
  await assert.rejects(dispatch(u, "admin:0"), { code: "denied" });
  await assert.rejects(dispatch(u, "av:1:1"), { code: "denied" });
  assert.equal(cloudMock.media.length, 0);
});
test("ordinary download caption contains the post author and link without raw HTML entities", async () => {
  const u = setup(
    '<img class="EmbeddedMediaImage" alt="Instagram post shared by &#064;creator" src="https://a.cdninstagram.com/full.jpg">',
  );
  await processURL(u, source);
  const call = cloudMock.calls.find((c) => c.method === "sendPhoto");
  assert.equal(call.params.caption, "@creator\n" + source);
  assert.equal(
    cloudMock.calls.some((c) => c.params.text?.startsWith("Sent all")),
    false,
  );
});
test("basic settings stay compact while advanced settings remain available and reset works", async () => {
  const u = setup("");
  await dispatch(u, "settings");
  let buttons = cloudMock.calls
    .at(-1)
    .params.reply_markup.inline_keyboard.flat();
  assert.equal(
    buttons.some((b) => b.callback_data === "pref:quality"),
    false,
  );
  assert.ok(buttons.some((b) => b.callback_data === "advanced"));
  await dispatch(u, "advanced");
  buttons = cloudMock.calls.at(-1).params.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === "pref:quality"));
  u.prefs.limit = 5;
  await dispatch(u, "reset");
  assert.equal(u.prefs.limit, 25);
});

test("a native database outage shows a short error without exposing SQL or hanging silently", async () => {
  setup("");
  cloudMock.db.run = async () => {
    throw Error("Sqlite error");
  };
  const { guarded } = await import("../tgcloud/lib/bot.js");
  let executed = false;
  await guarded(792399936, async () => {
    executed = true;
  });
  assert.equal(executed, false);
  assert.equal(
    cloudMock.calls.at(-1).params.text,
    "Temporarily unavailable. Please try again shortly.",
  );
});

test("original photo delivery sends unchanged file bytes as a document without Telegram photo recompression", async () => {
  const u = setup(
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg">',
  );
  u.prefs.photoOriginal = defaults.photoOriginal;
  const fetchOriginal = cloudMock.fetch;
  cloudMock.fetch = async (...args) => {
    const r = await fetchOriginal(...args);
    if (!args[0].startsWith("https://www.instagram.com/")) {
      const get = r.headers.get;
      r.headers.get = (k) => (k === "content-type" ? "image/png" : get(k));
    }
    return r;
  };
  await processURL(u, source);
  assert.equal(cloudMock.media[0].type, "document");
  assert.deepEqual(cloudMock.media[0].value.bytes, new Uint8Array(20));
  assert.equal(
    cloudMock.calls.some((c) => c.method === "sendPhoto"),
    false,
  );
});
function profileFixture(isPrivate = false) {
  return (
    "<script>s.handle(" +
    JSON.stringify({
      require: [
        [
          "Embed",
          "init",
          [],
          [
            {
              contextJSON: JSON.stringify({
                context: {
                  username: "person",
                  full_name: "Example Person",
                  followers_count: 200,
                  posts_count: 4,
                  hd_profile_pic_versions: [
                    {
                      url: "https://a.cdninstagram.com/full.jpg",
                      width: 1080,
                      height: 1080,
                    },
                  ],
                  is_private: isPrivate,
                  has_public_story: true,
                },
              }),
            },
          ],
        ],
      ],
    }) +
    ");</script>"
  );
}
test("profile auto-delivery includes public info and an in-bot Stories action", async () => {
  const u = setup(profileFixture());
  u.prefs.photoOriginal = true;
  await processURL(u, "https://www.instagram.com/person/");
  const p = cloudMock.calls.find((c) => c.method === "sendDocument").params;
  assert.ok(p.caption.includes("Example Person\n@person"));
  assert.ok(p.caption.includes("Followers: 200"));
  assert.ok(p.caption.includes("1080×1080"));
  const stories = p.reply_markup.inline_keyboard
    .flat()
    .find((b) => b.callback_data === "stories:person");
  assert.equal(stories.callback_data, "stories:person");
  assert.equal(stories.url, undefined);
});
test("private profiles never get a public Stories button", async () => {
  const u = setup(profileFixture(true));
  u.prefs.photoOriginal = true;
  await processURL(u, "https://www.instagram.com/person/");
  const p = cloudMock.calls.find((c) => c.method === "sendDocument").params;
  assert.ok(p.caption.includes("Private profile"));
  assert.equal(
    p.reply_markup.inline_keyboard
      .flat()
      .some((b) => b.callback_data?.startsWith("stories:")),
    false,
  );
});
test("explicit stateless fallback can deliver an original public photo during database failure and discloses missing history", async () => {
  setup(
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg">',
  );
  cloudMock.db.run = async () => {
    throw Error("Sqlite error");
  };
  const { guarded, receive } = await import("../tgcloud/lib/bot.js");
  await guarded(
    792399936,
    (u) => receive(u, { text: source }),
    { username: "itsAliRanjbar" },
    { allowStateless: true },
  );
  assert.equal(cloudMock.media[0].type, "document");
  const p = cloudMock.calls.find((c) => c.method === "sendDocument").params;
  assert.ok(p.caption.includes("not saved"));
  assert.equal(cloudMock.records.activity.length, 0);
});

test("database failure does not bypass public-user rate controls via unsaved downloads", async () => {
  setup(
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg">',
  );
  cloudMock.db.run = async () => {
    throw Error("Sqlite error");
  };
  const { guarded, receive } = await import("../tgcloud/lib/bot.js");
  await guarded(
    12345,
    (u) => receive(u, { text: source }),
    { username: "person" },
    { allowStateless: true },
  );
  assert.equal(cloudMock.media.length, 0);
  assert.equal(
    cloudMock.calls.at(-1).params.text,
    "Temporarily unavailable. Please try again shortly.",
  );
});

test("JPEG originals use verified native document URL delivery instead of the photo resize path", async () => {
  const u = setup(
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg">',
  );
  u.prefs.photoOriginal = true;
  await processURL(u, source);
  const p = cloudMock.calls.find((c) => c.method === "sendDocument").params;
  assert.equal(p.document, "https://a.cdninstagram.com/full.jpg");
  assert.equal(p.disable_content_type_detection, true);
  assert.equal(
    cloudMock.calls.some((c) => c.method === "sendPhoto"),
    false,
  );
});

test("a profile with no known adequate avatar resolution sends public info and Stories action", async () => {
  const html =
    "<script>s.handle(" +
    JSON.stringify({
      require: [
        [
          "Embed",
          "init",
          [],
          [
            {
              contextJSON: JSON.stringify({
                context: {
                  username: "person",
                  full_name: "Example",
                  profile_pic_url: "https://a.cdninstagram.com/100.jpg",
                  profile_pic_url_hd: "https://a.cdninstagram.com/320.jpg",
                  is_private: false,
                  has_public_story: true,
                },
              }),
            },
          ],
        ],
      ],
    }) +
    ");</script>";
  const u = setup(html);
  u.prefs.photoOriginal = true;
  await processURL(u, "https://www.instagram.com/person/");
  assert.equal(cloudMock.media.length, 0);
  const p = cloudMock.calls.at(-1).params;
  assert.ok(p.text.includes("above 500px"));
  assert.ok(
    p.reply_markup.inline_keyboard
      .flat()
      .some((b) => b.callback_data === "stories:person"),
  );
});

test("View Stories callback sends every retrieved story automatically, including pages and best existing video", async () => {
  const u = setup('<script>{"APP_ID":"936619743392459"}</script>');
  u.prefs.photoOriginal = true;
  const originalFetch = cloudMock.fetch;
  const response = (url, value) => ({
    url,
    ok: true,
    status: 200,
    headers: { get: (k) => (k === "content-type" ? "application/json" : null) },
    body: (async function* () {
      yield new TextEncoder().encode(JSON.stringify(value));
    })(),
  });
  cloudMock.fetch = async (url, opts) => {
    if (url.includes("web_profile_info"))
      return response(url, {
        data: {
          user: {
            id: "123",
            username: "person",
            is_private: false,
            has_public_story: true,
          },
        },
      });
    if (url.includes("feed/reels_media")) {
      const next = url.includes("max_id=");
      return response(url, {
        reels: {
          123: {
            items: next
              ? [
                  {
                    id: "v",
                    media_type: 2,
                    video_versions: [
                      {
                        url: "https://a.cdninstagram.com/720.mp4",
                        height: 720,
                      },
                      {
                        url: "https://a.cdninstagram.com/360.mp4",
                        height: 360,
                      },
                    ],
                  },
                ]
              : Array.from({ length: 11 }, (_, i) => ({
                  id: String(i),
                  media_type: 1,
                  image_versions2: {
                    candidates: [
                      {
                        url: `https://a.cdninstagram.com/story${i}.jpg`,
                        width: 1080,
                        height: 1920,
                      },
                    ],
                  },
                })),
            more_available: !next,
            ...(!next ? { next_max_id: "next" } : {}),
          },
        },
      });
    }
    return originalFetch(url, opts);
  };
  await dispatch(u, "stories:person");
  assert.equal(cloudMock.media.length, 12);
  assert.ok(cloudMock.media.slice(0, 11).every((m) => m.type === "document"));
  assert.equal(cloudMock.media[11].value, "https://a.cdninstagram.com/720.mp4");
  assert.equal(u.state.delivery.next, 12);
  assert.equal(cloudMock.records.activity[0].status, "sent");
});

test("owner menu exposes controls even during storage outage; other accounts never see them", async () => {
  const u = setup("");
  const { menu } = await import("../tgcloud/lib/bot.js");
  u.volatile = true;
  await menu(u);
  const buttons = cloudMock.calls
    .at(-1)
    .params.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((b) => b.callback_data === "owner:home"));
  assert.ok(buttons.some((b) => b.callback_data === "settings"));
  assert.ok(buttons.some((b) => b.callback_data === "history:0"));
  assert.ok(buttons.some((b) => b.callback_data === "owner:status"));
  await dispatch(u, "owner:home");
  assert.ok(
    cloudMock.calls.at(-1).params.text.includes("Storage is unavailable"),
  );
  cloudMock.db.get = async () => {
    throw Error("Sqlite error");
  };
  await dispatch(u, "owner:status");
  assert.ok(!cloudMock.calls.at(-1).params.text.includes("Sqlite"));
  const other = { ...u, id: 100 };
  await menu(other);
  assert.ok(
    !cloudMock.calls
      .at(-1)
      .params.reply_markup.inline_keyboard.flat()
      .some((b) => b.callback_data?.startsWith("owner:")),
  );
  await assert.rejects(dispatch(other, "owner:enabled"), { code: "denied" });
});
test("owner operational controls persist, enforce download policy, and survive personal reset", async () => {
  const u = setup(post(1));
  cloudMock.records.users.push({ id: u.id, prefs: "{}" });
  await dispatch(u, "owner:home");
  const buttons = cloudMock.calls
    .at(-1)
    .params.reply_markup.inline_keyboard.flat();
  for (const action of [
    "enabled",
    "maxMiB",
    "bulk",
    "interval",
    "retention",
    "recording",
  ]) {
    assert.ok(buttons.some((b) => b.callback_data === "owner:" + action));
    await dispatch(u, "owner:" + action);
  }
  assert.equal(u.prefs._controls.enabled, false);
  assert.equal(u.prefs._controls.maxMiB, 10);
  assert.equal(u.prefs._controls.bulk, 25);
  assert.equal(u.prefs._controls.interval, 5);
  assert.equal(u.prefs._controls.retention, 5000);
  assert.equal(u.prefs._controls.recording, false);
  assert.equal(
    JSON.parse(cloudMock.records.users[0].prefs)._controls.maxMiB,
    10,
  );
  await assert.rejects(processURL({ ...u, id: 100 }, source), {
    code: "downloadsPaused",
  });
  await dispatch(u, "owner:source:Instagram");
  await assert.rejects(processURL(u, source), { code: "sourceDisabled" });
  await dispatch(u, "reset");
  assert.equal(u.prefs._controls.disabled[0], "Instagram");
});
test("all owner source controls and ordinary settings buttons dispatch successfully", async () => {
  const u = setup("");
  await dispatch(u, "owner:sources");
  const sourceButtons = cloudMock.calls
    .at(-1)
    .params.reply_markup.inline_keyboard.flat()
    .filter((b) => b.callback_data.startsWith("owner:source:"));
  assert.equal(sourceButtons.length, 13);
  for (const b of sourceButtons) await dispatch(u, b.callback_data);
  for (const action of [
    "settings",
    "advanced",
    "language",
    "lang:fa",
    "lang:ar",
    "lang:en",
    "pref:quality",
    "pref:limit",
    "pref:mode",
    "pref:metadata",
    "pref:history",
    "pref:photoOriginal",
    "reset",
    "help",
    "privacy",
    "platforms",
    "platform:Instagram",
    "menu",
    "cancel",
    "owner:status",
    "owner:purge",
  ])
    await dispatch(u, action);
  assert.ok(
    cloudMock.calls
      .at(-1)
      .params.reply_markup.inline_keyboard.flat()
      .some((b) => b.callback_data === "owner:purge_yes"),
  );
});
test("confirmed owner purge removes all three stores; another user cannot request it", async () => {
  const u = setup("");
  cloudMock.records.users.push({ id: u.id }, { id: 1 });
  cloudMock.records.activity.push({ id: 1, userId: 1, source: "test" });
  cloudMock.records.locks.push({ id: 1, until: 0 });
  await assert.rejects(dispatch({ ...u, id: 1 }, "owner:purge_yes"), {
    code: "denied",
  });
  assert.equal(cloudMock.records.activity.length, 1);
  await dispatch(u, "owner:purge_yes");
  assert.equal(cloudMock.records.activity.length, 0);
  assert.equal(cloudMock.records.users.length, 0);
  assert.equal(cloudMock.records.locks.length, 0);
});
test("best-quality collection action sends one best format for every item", async () => {
  const node = {
    shortcode: "POST",
    carousel_media: [
      {
        id: "v",
        is_video: true,
        video_versions: [
          { url: "https://a.cdninstagram.com/720.mp4", height: 720 },
          { url: "https://a.cdninstagram.com/360.mp4", height: 360 },
        ],
      },
      { id: "p", display_url: "https://a.cdninstagram.com/p.jpg" },
    ],
  };
  const u = setup('"shortcode_media":' + JSON.stringify(node));
  await processURL(u, source);
  await dispatch(u, "pick:" + u.state.time + ":0");
  await dispatch(u, "pick:" + u.state.time + ":1");
  assert.equal(u.state.selected.length, 1);
  await dispatch(u, "get:" + u.state.time + ":best");
  assert.deepEqual(
    cloudMock.media.map((m) => m.value),
    ["https://a.cdninstagram.com/720.mp4", "https://a.cdninstagram.com/p.jpg"],
  );
});
test("View Stories success and failure never edit the original profile message", async () => {
  const profile = {
    username: "person",
    id: "123",
    is_private: false,
    has_public_story: true,
  };
  const u = setup(
    "<script>" +
      JSON.stringify({
        APP_ID: "123",
        user: profile,
        reel: {
          id: "123",
          user: profile,
          items: [
            {
              id: "s",
              media_type: 1,
              image_versions2: {
                candidates: [
                  {
                    url: "https://a.cdninstagram.com/story.jpg",
                    width: 1080,
                    height: 1920,
                  },
                ],
              },
            },
          ],
        },
      }) +
      "</script>",
  );
  await dispatch(u, "stories:person", 777);
  assert.equal(cloudMock.media.length, 1);
  assert.ok(
    !cloudMock.calls.some(
      (c) => c.method === "editMessageText" && c.params.message_id === 777,
    ),
  );
  const v = setup("<script>" + JSON.stringify({ user: profile }) + "</script>");
  await dispatch(v, "stories:person", 888);
  assert.ok(
    !cloudMock.calls.some(
      (c) => c.method === "editMessageText" && c.params.message_id === 888,
    ),
  );
});
