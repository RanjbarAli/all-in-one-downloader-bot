import test from "node:test";
import assert from "node:assert/strict";
import { storyFormats, htmlStoryReel } from "../tgcloud/lib/stories.js";
test("story thumbnails at or below 200px and unknown resolutions are not offered as full media", () => {
  for (const height of [100, 200, undefined]) {
    assert.throws(
      () =>
        storyFormats(
          {
            media_type: 2,
            video_versions: [
              { url: "https://a.cdninstagram.com/v.mp4", height },
            ],
          },
          "v",
        ),
      { code: "lowResolution" },
    );
    assert.throws(
      () =>
        storyFormats(
          {
            media_type: 1,
            image_versions2: {
              candidates: [
                {
                  url: "https://a.cdninstagram.com/p.jpg",
                  width: height,
                  height,
                },
              ],
            },
          },
          "p",
        ),
      { code: "lowResolution" },
    );
  }
});
test("story videos never become image posters even when the type flag is missing", () => {
  const fs = storyFormats(
    {
      video_resources: [
        { src: "https://a.cdninstagram.com/v.mp4", config_height: 720 },
      ],
      display_url: "https://a.cdninstagram.com/poster.jpg",
    },
    "v",
  );
  assert.equal(fs.length, 1);
  assert.equal(fs[0].kind, "video");
});
test("HTML reel container with contradictory owner is rejected even if keyed by target ID", () => {
  const html =
    "<script>" +
    JSON.stringify({
      reels: {
        123: { user: { id: "999", username: "other" }, items: [{ id: "v" }] },
      },
    }) +
    "</script>";
  assert.equal(htmlStoryReel([html], "person", "123"), null);
});
