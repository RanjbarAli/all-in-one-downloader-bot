import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, ctx, next) {
    if (specifier === "sdk") return { url: "mock:sdk", shortCircuit: true };
    return next(specifier, ctx);
  },
  load(url, ctx, next) {
    if (url === "mock:sdk")
      return {
        format: "module",
        source:
          "export const fetch=(...args)=>globalThis.networkMock(...args);",
        shortCircuit: true,
      };
    return next(url, ctx);
  },
});
const { bounded, request, extract, extractStories } = await import(
  "../tgcloud/lib/network.js"
);
const response = (url, type, body, status = 200) => ({
  url,
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get(k) {
      return k === "content-type"
        ? type
        : k === "content-length"
          ? String(body.length)
          : null;
    },
  },
  body: (async function* () {
    yield new TextEncoder().encode(body);
  })(),
});
test("bounded transfer stops unknown-size stream before exceeding cap", async () => {
  const r = {
    headers: { get: () => null },
    body: (async function* () {
      yield new Uint8Array(4);
      yield new Uint8Array(4);
    })(),
  };
  await assert.rejects(bounded(r, 5), { code: "large" });
});
test("known oversized body is rejected without reading", async () => {
  let read = false;
  const r = {
    headers: { get: () => 100 },
    body: (async function* () {
      read = true;
      yield new Uint8Array(100);
    })(),
  };
  await assert.rejects(bounded(r, 5), { code: "large" });
  assert.equal(read, false);
});
test("rejects redirects and validates final destination", async () => {
  globalThis.networkMock = async (url) => response(url, "text/html", "", 302);
  await assert.rejects(request("https://w3.org/a"), { code: "redirect" });
  globalThis.networkMock = async () =>
    response("https://127.0.0.1/", "text/html", "");
  await assert.rejects(request("https://w3.org/a"), { code: "invalid" });
});
test("HTML video players are never offered as downloadable video", async () => {
  globalThis.networkMock = async (url, opts) =>
    response(
      url,
      "text/html",
      opts.method === "HEAD"
        ? ""
        : '<meta property="og:video" content="https://www.youtube.com/embed/a">',
    );
  await assert.rejects(extract("https://www.youtube.com/watch?v=a"), {
    code: "restricted",
  });
});
test("real existing progressive resolutions remain distinct and get actual sizes", async () => {
  globalThis.networkMock = async (url, opts) =>
    url.includes("/config")
      ? response(
          url,
          "application/json",
          JSON.stringify({
            request: {
              files: {
                progressive: [
                  {
                    url: "https://video.vimeocdn.com/a.mp4",
                    mime: "video/mp4",
                    height: 720,
                    quality: "720p",
                  },
                  {
                    url: "https://video.vimeocdn.com/b.mp4",
                    mime: "video/mp4",
                    height: 360,
                    quality: "360p",
                  },
                ],
              },
            },
          }),
        )
      : response(url, "video/mp4", "data");
  const r = await extract("https://vimeo.com/123");
  assert.deepEqual(
    r.formats.map((f) => [f.height, f.size]),
    [
      [720, 4],
      [360, 4],
    ],
  );
});

test("every carousel slide is checked and a missing slide prevents false complete delivery", async () => {
  const node = {
    shortcode: "POST",
    carousel_media: Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      display_url: `https://a.cdninstagram.com/${i}.jpg`,
    })),
  };
  globalThis.networkMock = async (url, opts) =>
    url.startsWith("https://www.instagram.com/")
      ? response(url, "text/html", '"shortcode_media":' + JSON.stringify(node))
      : response(url, "image/jpeg", "data", url.endsWith("/8.jpg") ? 403 : 200);
  await assert.rejects(extract("https://www.instagram.com/p/POST/"), {
    code: "incompleteCollection",
  });
});
test("repeated source URL in different slides does not silently remove a carousel item", async () => {
  const node = {
    shortcode: "POST",
    carousel_media: [
      { id: "1", display_url: "https://a.cdninstagram.com/same.jpg" },
      { id: "2", display_url: "https://a.cdninstagram.com/same.jpg" },
    ],
  };
  globalThis.networkMock = async (url) =>
    url.startsWith("https://www.instagram.com/")
      ? response(url, "text/html", '"shortcode_media":' + JSON.stringify(node))
      : response(url, "image/jpeg", "data");
  const r = await extract("https://www.instagram.com/p/POST/");
  assert.equal(r.formats.length, 2);
  assert.equal(r.itemCount, 2);
});

function storyMock({
  pages = [],
  privateAccount = false,
  hasStory = true,
  rate = false,
} = {}) {
  const calls = [];
  globalThis.networkMock = async (url, opts) => {
    calls.push(url);
    if (url.includes("web_profile_info"))
      return response(
        url,
        "application/json",
        JSON.stringify({
          data: {
            user: {
              username: "person",
              id: "123",
              is_private: privateAccount,
              has_public_story: hasStory,
            },
          },
        }),
        rate ? 429 : 200,
      );
    if (url.includes("feed/reels_media"))
      return response(
        url,
        "application/json",
        JSON.stringify(pages.shift() || { reels: {} }),
      );
    if (url.startsWith("https://www.instagram.com/"))
      return response(
        url,
        "text/html",
        '<script>{"APP_ID":"936619743392459"}</script>',
      );
    return response(
      url,
      url.endsWith(".mp4") ? "video/mp4" : "image/jpeg",
      "data",
    );
  };
  return calls;
}
const storyImage = (id) => ({
  id,
  media_type: 1,
  image_versions2: {
    candidates: [
      {
        url: `https://a.cdninstagram.com/${id}-small.jpg`,
        width: 100,
        height: 100,
      },
      {
        url: `https://a.cdninstagram.com/${id}.jpg`,
        width: 1080,
        height: 1920,
      },
    ],
  },
});
test("stories traverse every exposed page, preserve order, choose largest photos and keep real video qualities", async () => {
  const calls = storyMock({
    pages: [
      {
        reels: {
          123: {
            items: Array.from({ length: 10 }, (_, i) => storyImage(String(i))),
            more_available: true,
            next_max_id: "page2",
          },
        },
      },
      {
        reels: {
          123: {
            items: [
              storyImage("9"),
              storyImage("10"),
              {
                id: "11",
                media_type: 2,
                video_versions: [
                  { url: "https://a.cdninstagram.com/720.mp4", height: 720 },
                  { url: "https://a.cdninstagram.com/360.mp4", height: 360 },
                ],
              },
            ],
          },
        },
      },
    ],
  });
  const r = await extractStories("person");
  assert.equal(r.itemCount, 12);
  assert.equal(r.formats.length, 13);
  assert.deepEqual(
    r.formats.slice(0, 11).map((f) => f.itemId),
    Array.from({ length: 11 }, (_, i) => String(i)),
  );
  assert.ok(r.formats.every((f) => !f.url.includes("small")));
  assert.ok(calls.some((url) => url.includes("max_id=page2")));
});
test("empty public feed is access restricted when active stories exist, never a false no-stories result", async () => {
  storyMock();
  await assert.rejects(extractStories("person"), { code: "storiesRestricted" });
  storyMock({ hasStory: false });
  await assert.rejects(extractStories("person"), { code: "noStories" });
});
test("private accounts and rate limits stop before requesting story files", async () => {
  let calls = storyMock({ privateAccount: true });
  await assert.rejects(extractStories("person"), { code: "storiesRestricted" });
  assert.ok(!calls.some((url) => url.includes("reels_media")));
  calls = storyMock({ rate: true });
  await assert.rejects(extractStories("person"), { code: "rate" });
  assert.equal(
    calls.filter((url) => url.includes("web_profile_info")).length,
    1,
  );
  assert.ok(!calls.some((url) => url.includes("reels_media")));
});
test("stories reject incomplete pages and video posters without real video files", async () => {
  storyMock({
    pages: [
      { reels: { 123: { items: [storyImage("1")], more_available: true } } },
    ],
  });
  await assert.rejects(extractStories("person"), {
    code: "incompleteCollection",
  });
  storyMock({
    pages: [
      { reels: { 123: { items: [{ ...storyImage("1"), media_type: 2 }] } } },
    ],
  });
  await assert.rejects(extractStories("person"), {
    code: "incompleteCollection",
  });
});
