import { decode, objectAfter } from "./media.js";
import { cleanText } from "./presentation.js";
export function instagramProfile(url) {
  const m = url.match(
    /^https:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?(?:\?[^#]*)?$/,
  );
  if (
    !m ||
    [
      "p",
      "reel",
      "reels",
      "tv",
      "stories",
      "accounts",
      "explore",
      "direct",
    ].includes(m[1].toLowerCase())
  )
    return null;
  return { username: m[1], url: `https://www.instagram.com/${m[1]}/` };
}
export function publicObjects(html) {
  const roots = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim();
    if (body.startsWith("{") || body.startsWith("[")) {
      try {
        roots.push(JSON.parse(body));
      } catch {}
    }
    for (const marker of [
      ".handle(",
      "window._sharedData",
      "window.__additionalDataLoaded",
    ]) {
      const x = objectAfter(body, marker);
      if (x) roots.push(x);
    }
  }
  return roots;
}
export function visitPublic(roots, fn) {
  const queue = roots.map((x) => ({ x, depth: 0 }));
  let visited = 0;
  while (queue.length && visited++ < 15000) {
    const { x, depth } = queue.shift();
    if (!x || typeof x !== "object" || depth > 30) continue;
    fn(x);
    for (const [k, v] of Object.entries(x)) {
      if (k === "contextJSON" && typeof v === "string") {
        try {
          queue.push({ x: JSON.parse(v), depth: depth + 1 });
        } catch {}
      } else if (v && typeof v === "object")
        queue.push({ x: v, depth: depth + 1 });
    }
  }
}
function metadata(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of m[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))
      attrs[a[1].toLowerCase()] = cleanText(a[3]);
    if ((attrs.property || attrs.name) === key) return attrs.content || "";
  }
  return "";
}
function dimensions(url) {
  let stp = "";
  try {
    stp = decodeURIComponent(url.match(/[?&]stp=([^&]*)/)?.[1] || "");
  } catch {}
  const m =
    stp.match(/(?:^|_)(?:s|p)(\d+)x(\d+)(?:_|$)/) ||
    url.match(/\/(?:s|p)(\d+)x(\d+)\//);
  return m
    ? { width: Number(m[1]), height: Number(m[2]) }
    : { width: 0, height: 0 };
}
export function profileData(username, htmls, extra = []) {
  const p = {
    username,
    source: `https://www.instagram.com/${username}/`,
    isPrivate: null,
    hasPublicStory: null,
  };
  const images = [];
  function image(url, details = {}, hd = false, profileOriginal = false) {
    if (typeof url !== "string" || !url.startsWith("https://")) return;
    const existing = images.find((f) => f.url === decode(url));
    if (existing) {
      if (profileOriginal) {
        existing.profileOriginal = true;
        existing.original = true;
        existing.width = Number(details.width) || existing.width;
        existing.height = Number(details.height) || existing.height;
      }
      return;
    }
    const dims = dimensions(url);
    images.push({
      url: decode(url),
      kind: "photo",
      itemId: "profile",
      original: profileOriginal,
      profileOriginal,
      hd,
      width: Number(details.width) || dims.width,
      height: Number(details.height) || dims.height,
      label: "Profile photo",
    });
  }
  for (const html of htmls) {
    const title = metadata(html, "og:title");
    if (!p.name && title.includes("@" + username))
      p.name = title.split(/\s*\(@/)[0];
    const desc = metadata(html, "og:description");
    for (const [field, label] of [
      ["followers", "Followers"],
      ["following", "Following"],
      ["posts", "Posts"],
    ]) {
      const count = desc.match(
        new RegExp("([\\d.,]+\\s*[KMB]?)\\s+" + label, "i"),
      )?.[1];
      if (count && p[field] === undefined) p[field] = count;
    }
    const og = metadata(html, "og:image");
    if (og) image(og);
  }
  visitPublic([...htmls.flatMap(publicObjects), ...extra], (node) => {
    if (
      typeof node.username !== "string" ||
      node.username.toLowerCase() !== username.toLowerCase()
    )
      return;
    const id = String(node.id || node.owner_id || "");
    if (/^\d{1,30}$/.test(id)) p.id = id;
    if (node.full_name) p.name = cleanText(node.full_name);
    if (node.biography !== undefined) p.bio = cleanText(node.biography);
    if (typeof node.is_private === "boolean") p.isPrivate = node.is_private;
    if (typeof node.has_public_story === "boolean")
      p.hasPublicStory = node.has_public_story;
    if (typeof node.is_verified === "boolean") p.verified = node.is_verified;
    for (const [field, value] of [
      [
        "followers",
        node.edge_followed_by?.count ??
          node.follower_count ??
          node.followers_count,
      ],
      ["following", node.edge_follow?.count ?? node.following_count],
      [
        "posts",
        node.edge_owner_to_timeline_media?.count ??
          node.media_count ??
          node.posts_count,
      ],
    ])
      if (value !== undefined && value !== null) p[field] = value;
    image(node.profile_pic_url_hd, {}, true);
    image(
      node.hd_profile_pic_url_info?.url,
      node.hd_profile_pic_url_info,
      true,
      true,
    );
    for (const pic of node.hd_profile_pic_versions || [])
      image(pic.url, pic, true, true);
    image(node.profile_pic_url);
  });
  images.sort((a, b) => {
    const aa = a.width * a.height,
      bb = b.width * b.height;
    return aa && bb ? bb - aa : Number(b.hd) - Number(a.hd) || bb - aa;
  });
  return { profile: p, images };
}
