import test from "node:test";
import assert from "node:assert/strict";
import { instagramMedia } from "../tgcloud/lib/instagram.js";
import { automaticSelection, allSelection } from "../tgcloud/lib/selection.js";
const image = (id) => ({
  id: String(id),
  display_resources: [
    {
      src: `https://a.cdninstagram.com/${id}-square.jpg`,
      config_width: 640,
      config_height: 640,
    },
    {
      src: `https://a.cdninstagram.com/${id}-full.jpg`,
      config_width: 1080,
      config_height: 1350,
    },
  ],
});
test("Instagram uses full media resources instead of square metadata previews", () => {
  const html =
    '<meta property="og:image" content="https://a.cdninstagram.com/crop.jpg"><script>var x={"shortcode_media":' +
    JSON.stringify({ ...image(1), shortcode: "POST" }) +
    "}</script>";
  const r = instagramMedia(html, "POST");
  assert.equal(r.formats[0].url, "https://a.cdninstagram.com/1-full.jpg");
  assert.equal(r.formats[0].height, 1350);
});
test("public embed preserves source srcset and aspect, without changing signed CDN URL", () => {
  const html =
    '<img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/full.jpg?stp=dst-jpg&amp;a=1" srcset="https://a.cdninstagram.com/full.jpg?stp=dst-jpg&amp;a=1 1080w">';
  assert.equal(
    instagramMedia(html, "POST").formats[0].url,
    "https://a.cdninstagram.com/full.jpg?stp=dst-jpg&a=1",
  );
});
test("all carousel children preserve order and no three/six-item truncation remains", () => {
  const node = {
    shortcode: "POST",
    edge_sidecar_to_children: {
      edges: Array.from({ length: 12 }, (_, i) => ({ node: image(i) })),
    },
  };
  const r = instagramMedia('"shortcode_media":' + JSON.stringify(node), "POST");
  assert.equal(r.formats.length, 12);
  assert.deepEqual(
    r.formats.map((f) => f.itemId),
    Array.from({ length: 12 }, (_, i) => String(i)),
  );
  assert.equal(automaticSelection(r.formats, 1000).length, 12);
});
test("mixed image/video carousel is a collection, not alternative qualities", () => {
  const node = {
    code: "POST",
    carousel_media: [
      {
        pk: 1,
        image_versions2: {
          candidates: [
            {
              url: "https://a.cdninstagram.com/a.jpg",
              width: 1080,
              height: 1350,
            },
          ],
        },
      },
      {
        pk: 2,
        media_type: 2,
        video_versions: [
          { url: "https://a.cdninstagram.com/v.mp4", height: 720 },
        ],
      },
    ],
  };
  const r = instagramMedia('"shortcode_media":' + JSON.stringify(node), "POST");
  assert.deepEqual(
    automaticSelection(r.formats, 1000).map((f) => f.kind),
    ["photo", "video"],
  );
});
test("real alternate qualities require selection; send all chooses one per item", () => {
  const fs = [
    {
      itemId: "1",
      kind: "video",
      url: "https://w3.org/720.mp4",
      height: 720,
      size: 20,
    },
    {
      itemId: "1",
      kind: "video",
      url: "https://w3.org/360.mp4",
      height: 360,
      size: 10,
    },
    { itemId: "2", kind: "photo", url: "https://w3.org/a.jpg", size: 5 },
  ];
  assert.equal(automaticSelection(fs, 25), null);
  assert.deepEqual(
    allSelection(fs, 25).map((f) => f.url),
    ["https://w3.org/720.mp4", "https://w3.org/a.jpg"],
  );
});
test("single playable file auto-sends and thumbnails never become extra slides", () => {
  const fs = [
    { kind: "video", url: "https://w3.org/v.mp4", size: 1 },
    { kind: "photo", url: "https://w3.org/thumb.jpg", preview: true },
  ];
  assert.equal(automaticSelection(fs, 25).length, 1);
  assert.equal(automaticSelection([fs[1]], 25), null);
});
test("incomplete or inaccessible original carousel is never silently replaced with one cropped image", () => {
  assert.equal(
    instagramMedia(
      '<meta property="og:image" content="https://a.cdninstagram.com/crop.jpg">',
      "POST",
    ),
    null,
  );
  assert.throws(
    () =>
      instagramMedia(
        '<script>{"isSidecar":true}</script><img class="EmbeddedMediaImage" src="https://a.cdninstagram.com/first.jpg">',
        "POST",
      ),
    { code: "incompleteCollection" },
  );
  assert.throws(
    () =>
      instagramMedia(
        '"shortcode_media":' +
          JSON.stringify({
            shortcode: "POST",
            carousel_media_count: 3,
            carousel_media: [image(1)],
          }),
        "POST",
      ),
    { code: "incompleteCollection" },
  );
});
