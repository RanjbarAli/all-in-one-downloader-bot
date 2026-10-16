import { publicObjects, visitPublic } from "./profiles.js";
import { decode, MediaError } from "./media.js";

// Only accept a story reel whose owner matches the requested account.
export function storyReel(roots, username, userId) {
  let found = null;
  function consider(reel, keyed = false) {
    if (!Array.isArray(reel?.items) || !reel.items.length) return;
    const owner = reel.user || reel.owner || {};
    const id = String(owner.id || owner.pk || reel.id || "");
    const name = String(owner.username || "").toLowerCase();
    if (name && name !== username.toLowerCase()) return;
    if (userId && (owner.id || owner.pk) && id !== String(userId)) return;
    if (
      keyed ||
      (userId && id === String(userId)) ||
      name === username.toLowerCase()
    ) {
      if (!found || reel.items.length > found.items.length) found = reel;
    }
  }
  visitPublic(roots, (node) => {
    if (userId) consider(node.reels?.[userId], true);
    if (Array.isArray(node.reels_media))
      for (const reel of node.reels_media) consider(reel);
    consider(node.reel);
    if (/reel/i.test(node.__typename || "")) consider(node);
  });
  return found;
}
export function htmlStoryReel(pages, username, userId) {
  return storyReel(pages.flatMap(publicObjects), username, userId);
}
export function storyFormats(item, id) {
  const video =
    item.media_type === 2 ||
    item.is_video === true ||
    item.__typename === "GraphStoryVideo" ||
    !!item.video_url ||
    (Array.isArray(item.video_versions) && item.video_versions.length > 0) ||
    (Array.isArray(item.video_resources) && item.video_resources.length > 0);
  if (video) {
    const versions = [
      ...(item.video_versions || []),
      ...(item.video_resources || []),
    ];
    if (item.video_url)
      versions.push({ url: item.video_url, height: item.dimensions?.height });
    const seen = new Set();
    const formats = versions
      .filter((v) => {
        const url = v.url || v.src;
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .map((v) => ({
        url: decode(v.url || v.src),
        itemId: id,
        kind: "video",
        height: Number(v.height || v.config_height) || 0,
        label: "Video",
      }));
    if (!formats.length) throw new MediaError("incompleteCollection");
    const large = formats.filter((f) => f.height > 200);
    if (!large.length) throw new MediaError("lowResolution");
    return large;
  }
  const candidates = [
    ...(item.image_versions2?.candidates || []),
    ...(item.display_resources || []),
  ];
  if (item.display_url)
    candidates.push({
      url: item.display_url,
      width: item.dimensions?.width,
      height: item.dimensions?.height,
    });
  candidates.sort(
    (a, b) =>
      (b.width || b.config_width || 0) * (b.height || b.config_height || 0) -
      (a.width || a.config_width || 0) * (a.height || a.config_height || 0),
  );
  const image = candidates.find((v) => v.url || v.src);
  if (!image) throw new MediaError("incompleteCollection");
  if (
    !(
      Number(image.width || image.config_width) > 200 &&
      Number(image.height || image.config_height) > 200
    )
  )
    throw new MediaError("lowResolution");
  return [
    {
      url: decode(image.url || image.src),
      itemId: id,
      kind: "photo",
      width: Number(image.width || image.config_width) || 0,
      height: Number(image.height || image.config_height) || 0,
      original: true,
      label: "Image",
    },
  ];
}
