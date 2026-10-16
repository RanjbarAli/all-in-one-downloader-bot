import { decode, objectAfter, MediaError } from "./media.js";

export function instagramPost(url) {
  const m = url.match(
    /^https:\/\/(?:www\.)?instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i,
  );
  return m
    ? {
        shortcode: m[2],
        canonical: `https://www.instagram.com/${m[1] === "reels" ? "reel" : m[1]}/${m[2]}/`,
      }
    : null;
}
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))
    out[m[1].toLowerCase()] = decode(m[3]);
  return out;
}
function bestImage(node) {
  const candidates =
    node.image_versions2?.candidates ||
    node.display_resources?.map((x) => ({
      url: x.src,
      width: x.config_width,
      height: x.config_height,
    })) ||
    [];
  const images = candidates
    .filter((x) => typeof x.url === "string")
    .sort(
      (a, b) =>
        (Number(b.width) || 0) * (Number(b.height) || 0) -
        (Number(a.width) || 0) * (Number(a.height) || 0),
    );
  if (images.length) return images[0];
  return node.display_url
    ? {
        url: node.display_url,
        width: node.dimensions?.width,
        height: node.dimensions?.height,
      }
    : null;
}
function mediaFromNode(node, shortcode) {
  if (
    !node ||
    typeof node !== "object" ||
    (node.shortcode && node.shortcode !== shortcode) ||
    (node.code && node.code !== shortcode)
  )
    return null;
  const children =
    node.carousel_media ||
    node.edge_sidecar_to_children?.edges?.map((e) => e.node);
  const items = children || [node];
  const formats = [];
  if (items.length > 50) throw new MediaError("collectionLimit");
  for (let i = 0; i < items.length; i++) {
    const child = items[i];
    const itemId = String(child.id || child.pk || i);
    const video =
      child.is_video ||
      child.media_type === 2 ||
      child.__typename === "GraphVideo";
    if (video) {
      const variants =
        child.video_versions ||
        (child.video_url
          ? [
              {
                url: child.video_url,
                width: child.dimensions?.width,
                height: child.dimensions?.height,
              },
            ]
          : []);
      for (const v of variants)
        if (v.url)
          formats.push({
            url: decode(v.url),
            kind: "video",
            height: Number(v.height) || 0,
            itemId,
            label: "Video",
          });
    } else {
      const image = bestImage(child);
      if (image)
        formats.push({
          url: decode(image.url),
          kind: "photo",
          width: Number(image.width) || 0,
          height: Number(image.height) || 0,
          itemId,
          original: true,
          label: "Image",
        });
    }
    if (!formats.some((f) => f.itemId === itemId)) return null;
  }
  if (!formats.length) return null;
  const expected = Number(node.carousel_media_count) || items.length;
  if (expected > items.length) throw new MediaError("incompleteCollection");
  const author = node.owner?.username || node.user?.username || "";
  return { formats, collection: !!children, itemCount: items.length, author };
}
export function instagramMedia(html, shortcode) {
  // Only read the requested post object. Never walk unrelated recommendations.
  for (const marker of ['"xdt_shortcode_media":', '"shortcode_media":']) {
    const node = objectAfter(html, marker);
    const result = mediaFromNode(node, shortcode);
    if (result) return result;
  }
  const roots = [];
  for (const tag of html.matchAll(
    /<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      roots.push(JSON.parse(tag[1]));
    } catch {}
  }
  for (const marker of [
    ".handle(",
    "window._sharedData",
    "window.__additionalDataLoaded",
  ]) {
    const root = objectAfter(html, marker);
    if (root) roots.push(root);
  }
  const queue = roots.map((x) => ({ x, depth: 0 }));
  let visited = 0;
  while (queue.length && visited++ < 10000) {
    const { x, depth } = queue.shift();
    if (!x || typeof x !== "object" || depth > 25) continue;
    if (
      (x.shortcode === shortcode || x.code === shortcode) &&
      (x.display_url ||
        x.image_versions2 ||
        x.video_versions ||
        x.video_url ||
        x.carousel_media ||
        x.edge_sidecar_to_children)
    ) {
      const result = mediaFromNode(x, shortcode);
      if (result) return result;
    }
    for (const [key, value] of Object.entries(x)) {
      if (key === "contextJSON" && typeof value === "string") {
        try {
          queue.push({ x: JSON.parse(value), depth: depth + 1 });
        } catch {}
      } else if (value && typeof value === "object")
        queue.push({ x: value, depth: depth + 1 });
    }
  }
  // Public embed supplies a full-aspect media image, unlike square og:image.
  // If a carousel is announced but its children are absent, do not fake completion.
  const isSidecar = /"isSidecar"\s*:\s*true/.test(html.replace(/\\"/g, '"'));
  const images = [];
  let author = "";
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!a.class?.split(/\s+/).includes("EmbeddedMediaImage")) continue;
    author ||= a.alt?.match(/@([a-zA-Z0-9_.]{1,64})/)?.[1] || "";
    const candidates = (a.srcset || "")
      .split(/,\s*/)
      .map((v) => {
        const [url, size] = v.trim().split(/\s+/);
        return { url, width: parseInt(size) || 0 };
      })
      .filter((x) => x.url?.startsWith("https://"));
    candidates.sort((a, b) => b.width - a.width);
    const url = candidates[0]?.url || a.src;
    if (url && !images.some((x) => x.url === url))
      images.push({
        url,
        kind: "photo",
        itemId: String(images.length),
        original: true,
        label: "Image",
      });
  }
  if (isSidecar) throw new MediaError("incompleteCollection");
  const videoPost =
    /"isVideo"\s*:\s*true/.test(html.replace(/\\"/g, '"')) ||
    /<[^>]+class=["'][^"']*(?:EmbeddedMediaVideo|VideoPlayButton)[^"']*["']/i.test(
      html,
    );
  if (videoPost) return null;
  if (images.length)
    return {
      formats: images,
      collection: images.length > 1,
      itemCount: images.length,
      author,
    };
  return null;
}
