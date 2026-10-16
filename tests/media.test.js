import test from "node:test";
import assert from "node:assert/strict";
import {
  safeURL,
  detect,
  profileURL,
  choose,
  htmlFormats,
  filename,
} from "../tgcloud/lib/media.js";
import { dictionaries, t } from "../tgcloud/lib/i18n.js";
test("rejects private addresses, credentials, unapproved hosts, unsafe schemes and encodings", () => {
  for (const u of [
    "http://w3.org/a",
    "https://127.0.0.1/a",
    "https://2130706433/a",
    "https://[::1]/",
    "https://localhost/",
    "https://w3.org.evil.com/a",
    "https://user@w3.org/a",
    "https://w3.org:8443/a",
    "https://w3.org\\@localhost/",
    "https://w3.org./",
    "https://foo.local/a",
    "https://w3.org/a\n",
  ])
    assert.throws(() => safeURL(u), u);
});
test("recognizes domains at boundaries and accepts official media CDNs", () => {
  assert.equal(detect("https://www.youtube.com/watch?v=x"), "YouTube");
  assert.equal(detect("https://i.redd.it/a.png"), "Reddit");
  assert.equal(detect("https://upload.wikimedia.org/a.jpg"), "Direct");
});
test("best quality chooses highest complete format within limit", () => {
  const fs = [
    { height: 1080, size: 75 },
    { height: 720, size: 24 },
    { height: 480, size: 14 },
    { height: 2160, size: 10, silent: true },
    { height: 4320, size: 1, segmented: true },
  ];
  assert.equal(choose(fs, 25).height, 720);
  assert.equal(choose(fs, 25, "480").height, 480);
  assert.equal(choose(fs, 10), undefined);
});
test("parses real metadata, decodes entities and does not invent formats", () => {
  assert.deepEqual(
    htmlFormats(
      '<meta property="og:video" content="https://v.redd.it/a.mp4?a=1&amp;b=2">',
    ),
    [{ url: "https://v.redd.it/a.mp4?a=1&b=2", kind: "video", label: "Video" }],
  );
  assert.deepEqual(htmlFormats("<html>login</html>"), []);
});
test("profile handling validates username and supported platform", () => {
  assert.equal(
    profileURL("Instagram", "@test"),
    "https://www.instagram.com/test",
  );
  assert.throws(() => profileURL("Instagram", "../etc"));
  assert.throws(() => profileURL("Snapchat", "test"));
});
test("preserves safe filenames", () => {
  assert.equal(filename("https://w3.org/video.mp4?x=1", "video"), "video.mp4");
  assert.equal(filename("https://w3.org/a.exe", "video"), "media.mp4");
});
test("all English UI strings have Persian and Arabic translations", () => {
  for (const lang of ["fa", "ar"])
    for (const key of Object.keys(dictionaries.en))
      assert.equal(typeof dictionaries[lang][key], "string", lang + ":" + key);
  assert.equal(t("unknown", "menu"), "Main menu");
});

test("embedded JSON is parsed without evaluating scripts and handles quoted braces", async () => {
  const { objectAfter } = await import("../tgcloud/lib/media.js");
  assert.deepEqual(
    objectAfter(
      'var ytInitialPlayerResponse = {"title":"a } b", "x":{"n":1}}; evil();',
      "ytInitialPlayerResponse",
    ),
    { title: "a } b", x: { n: 1 } },
  );
  assert.equal(
    objectAfter(
      "var ytInitialPlayerResponse = {not:json};",
      "ytInitialPlayerResponse",
    ),
    null,
  );
});
test("YouTube formats exclude signature cipher and separate silent video", async () => {
  const { embeddedFormats } = await import("../tgcloud/lib/media.js");
  const p = {
    streamingData: {
      formats: [
        {
          mimeType: "video/mp4",
          url: "https://a.googlevideo.com/ok",
          height: 360,
        },
        { mimeType: "video/mp4", signatureCipher: "secret", height: 1080 },
      ],
      adaptiveFormats: [
        {
          mimeType: "video/mp4",
          url: "https://a.googlevideo.com/silent",
          height: 2160,
        },
        { mimeType: "audio/mp4", url: "https://a.googlevideo.com/audio" },
      ],
    },
  };
  const out = embeddedFormats(
    "ytInitialPlayerResponse = " + JSON.stringify(p),
    "YouTube",
  );
  assert.deepEqual(
    out.map((f) => f.kind),
    ["video", "audio"],
  );
  assert.equal(out[0].height, 360);
});
test("TikTok public JSON yields exposed files without invented resolutions", async () => {
  const { embeddedFormats } = await import("../tgcloud/lib/media.js");
  const p = {
    __DEFAULT_SCOPE__: {
      "webapp.video-detail": {
        itemInfo: {
          itemStruct: {
            video: { playAddr: "https://a.tiktokcdn.com/a.mp4", height: 720 },
          },
        },
      },
    },
  };
  const out = embeddedFormats(
    '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">' +
      JSON.stringify(p) +
      "</script>",
    "TikTok",
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].height, 720);
});
