import test from "node:test";
import assert from "node:assert/strict";
import { profileData, instagramProfile } from "../tgcloud/lib/profiles.js";
import { profileCaption } from "../tgcloud/lib/presentation.js";
function embed(context) {
  return (
    "<script>requireLazy([],function(){s.handle(" +
    JSON.stringify({
      require: [
        [
          "PolarisEmbedSimple",
          "init",
          [],
          [{ contextJSON: JSON.stringify({ context }) }],
        ],
      ],
    }) +
    ");});</script>"
  );
}
test("public profile embed supplies exact public counts and privacy flags without credentials", () => {
  const html = embed({
    username: "person",
    full_name: "Example Person",
    followers_count: 15000,
    posts_count: 12,
    profile_pic_url:
      "https://a.cdninstagram.com/p.jpg?stp=dst-jpg_s100x100_tt6",
    graphql_media: {
      owner: {
        username: "person",
        is_private: false,
        has_public_story: true,
        edge_followed_by: { count: 14832 },
      },
    },
  });
  const r = profileData("person", [html]);
  assert.equal(r.profile.followers, 14832);
  assert.equal(r.profile.isPrivate, false);
  assert.equal(r.profile.hasPublicStory, true);
  assert.equal(r.images[0].width, 100);
});
test("profile selects the largest exposed original avatar without rewriting CDN resize/signature parameters", () => {
  const user = {
    username: "person",
    profile_pic_url:
      "https://a.cdninstagram.com/small.jpg?stp=dst-jpg_s100x100_tt6",
    hd_profile_pic_versions: [
      { url: "https://a.cdninstagram.com/hd320.jpg", width: 320, height: 320 },
      {
        url: "https://a.cdninstagram.com/hd1080.jpg",
        width: 1080,
        height: 1080,
      },
    ],
  };
  const r = profileData("person", [embed(user)]);
  assert.equal(r.images[0].url, "https://a.cdninstagram.com/hd1080.jpg");
  assert.equal(r.images[0].width, 1080);
  assert.equal(r.images.at(-1).url, user.profile_pic_url);
});
test("unrelated account avatars never replace the requested profile", () => {
  const r = profileData("person", [
    embed({
      username: "another",
      profile_pic_url_hd: "https://a.cdninstagram.com/unrelated.jpg",
    }),
  ]);
  assert.equal(r.images.length, 0);
  assert.equal(r.profile.isPrivate, null);
});
test("profile captions contain available information and label actual source resolution honestly", () => {
  const text = profileCaption({
    name: "Example",
    username: "person",
    followers: 14832,
    following: 223,
    posts: 529,
    isPrivate: false,
    photoWidth: 100,
    photoHeight: 100,
    source: "https://www.instagram.com/person/",
  });
  assert.ok(text.includes("@person"));
  assert.ok(text.includes("14,832"));
  assert.ok(text.includes("100×100"));
  assert.ok(!text.includes("1080"));
  assert.ok(text.endsWith("https://www.instagram.com/person/"));
  assert.equal(instagramProfile("https://www.instagram.com/p/POST/"), null);
});

test("320px web HD thumbnail is never accepted as an original DP", () => {
  const r = profileData("person", [
    embed({
      username: "person",
      profile_pic_url: "https://a.cdninstagram.com/100.jpg",
      profile_pic_url_hd: "https://a.cdninstagram.com/320.jpg",
    }),
  ]);
  assert.equal(
    r.images.some((i) => i.profileOriginal),
    false,
  );
});
test("native original-DP metadata upgrades a duplicate avatar URL without losing source dimensions", () => {
  const url = "https://a.cdninstagram.com/dp.jpg";
  const r = profileData("person", [
    embed({
      username: "person",
      profile_pic_url_hd: url,
      hd_profile_pic_url_info: { url, width: 1080, height: 1080 },
    }),
  ]);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].profileOriginal, true);
  assert.equal(r.images[0].width, 1080);
});
