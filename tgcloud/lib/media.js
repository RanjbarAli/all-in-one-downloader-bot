import { MAX_BYTES } from "./config.js";
export class MediaError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
const domains = {
  Instagram: ["instagram.com"],
  YouTube: ["youtube.com", "youtu.be"],
  TikTok: ["tiktok.com"],
  Facebook: ["facebook.com", "fb.watch"],
  X: ["x.com", "twitter.com"],
  Pinterest: ["pinterest.com", "pin.it"],
  Reddit: ["reddit.com", "redd.it"],
  Threads: ["threads.net", "threads.com"],
  Vimeo: ["vimeo.com"],
  Dailymotion: ["dailymotion.com", "dai.ly"],
  Twitch: ["twitch.tv", "clips.twitch.tv"],
  Snapchat: ["snapchat.com"],
};
const cdns = [
  "cdninstagram.com",
  "fbcdn.net",
  "tiktokcdn.com",
  "tiktokcdn-us.com",
  "tiktokv.com",
  "twimg.com",
  "pinimg.com",
  "redd.it",
  "redditmedia.com",
  "vimeocdn.com",
  "dmcdn.net",
  "googlevideo.com",
  "ytimg.com",
  "sc-cdn.net",
  "twitchcdn.net",
  "akamaized.net",
  "archive.org",
  "wikimedia.org",
  "w3.org",
  "download.blender.org",
  "samplelib.com",
];
const belongs = (h, d) => h === d || h.endsWith("." + d);
export function safeURL(value) {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    /[\s\\\x00-\x1f]/.test(value)
  )
    throw new MediaError("invalid");
  const m = value.match(
    /^https:\/\/([a-z0-9.-]+)(?::443)?(\/[^#]*)?(?:#.*)?$/i,
  );
  if (!m) throw new MediaError("invalid");
  const host = m[1].toLowerCase();
  if (
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.endsWith(".") ||
    host.split(".").some((x) => !x || x.startsWith("-") || x.endsWith("-"))
  )
    throw new MediaError("invalid");
  if (
    !Object.values(domains)
      .flat()
      .concat(cdns)
      .some((d) => belongs(host, d))
  )
    throw new MediaError("host");
  return { url: value.split("#")[0], host };
}
export function detect(url) {
  const { host } = safeURL(url);
  return (
    Object.keys(domains).find((p) =>
      domains[p].some((d) => belongs(host, d)),
    ) || "Direct"
  );
}
export function profileURL(platform, input) {
  const name = input.replace(/^@/, "");
  if (!/^[a-zA-Z0-9_.-]{1,50}$/.test(name)) throw new MediaError("invalid");
  const roots = {
    Instagram: "https://www.instagram.com/",
    TikTok: "https://www.tiktok.com/@",
    X: "https://x.com/",
    Reddit: "https://www.reddit.com/user/",
    YouTube: "https://www.youtube.com/@",
    Vimeo: "https://vimeo.com/",
    Threads: "https://www.threads.net/@",
    Pinterest: "https://www.pinterest.com/",
  };
  if (!roots[platform]) throw new MediaError("profile");
  return roots[platform] + name;
}
export function choose(formats, limit = MAX_BYTES, preferred = "auto") {
  const valid = formats.filter(
    (f) => !f.segmented && !f.silent && (!f.size || f.size <= limit),
  );
  return valid.sort((a, b) => {
    if (preferred === "audio")
      return (b.kind === "audio") - (a.kind === "audio");
    const cap = Number(preferred) || Infinity;
    return (
      (b.kind === "video") - (a.kind === "video") ||
      (b.height <= cap) - (a.height <= cap) ||
      (b.height || 0) - (a.height || 0)
    );
  })[0];
}
export function decode(s) {
  return s
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => {
      const v =
        n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n);
      return v <= 0x10ffff ? String.fromCodePoint(v) : "";
    })
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
export function htmlFormats(html) {
  const out = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))
      a[m[1].toLowerCase()] = decode(m[2]);
    const key = a.property || a.name || "";
    if (
      /^(og:video(:url|:secure_url)?|twitter:player:stream|og:image(:url|:secure_url)?)$/.test(
        key,
      ) &&
      a.content
    ) {
      out.push({
        url: a.content,
        kind: key.includes("image") ? "photo" : "video",
        label: key.includes("image") ? "Image" : "Video",
        ...(key.includes("image") ? { preview: true } : {}),
      });
    }
  }
  return out;
}
export function kindFor(type, url) {
  if (type.startsWith("image/")) return "photo";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (/\.(mp4|webm)(\?|$)/i.test(url)) return "video";
  return null;
}
export function filename(url, kind, mime = "") {
  let part = url.split("?")[0].split("/").pop() || "";
  try {
    part = decodeURIComponent(part);
  } catch {}
  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "video/webm": "webm",
  }[mime];
  if (
    extension &&
    !new RegExp(
      "\\.(?:" + (extension === "jpg" ? "jpe?g" : extension) + ")$",
      "i",
    ).test(part)
  )
    return "media." + extension;
  return /^[\w .()-]{1,100}\.(mp4|webm|jpg|jpeg|png|gif|mp3|m4a|ogg|wav)$/i.test(
    part,
  )
    ? part
    : `media.${{ photo: "jpg", video: "mp4", audio: "mp3" }[kind] || "bin"}`;
}
// Read a JSON object embedded in public HTML without evaluating source code.
export function objectAfter(html, marker) {
  const pos = html.indexOf(marker);
  if (pos < 0) return null;
  const start = html.indexOf("{", pos + marker.length);
  if (start < 0) return null;
  let depth = 0,
    string = false,
    escape = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (string) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') string = false;
    } else if (c === '"') string = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
export function embeddedFormats(html, platform) {
  const out = [];
  if (platform === "YouTube") {
    const p = objectAfter(html, "ytInitialPlayerResponse");
    for (const f of p?.streamingData?.formats || [])
      if (
        f.url &&
        !f.signatureCipher &&
        !f.cipher &&
        f.mimeType?.startsWith("video/mp4")
      )
        out.push({
          url: f.url,
          kind: "video",
          height: f.height || 0,
          size: Number(f.contentLength) || null,
          label: f.qualityLabel || "Video",
        });
    for (const f of p?.streamingData?.adaptiveFormats || [])
      if (
        f.url &&
        !f.signatureCipher &&
        !f.cipher &&
        f.mimeType?.startsWith("audio/")
      )
        out.push({
          url: f.url,
          kind: "audio",
          size: Number(f.contentLength) || null,
          label: "Audio",
        });
  }
  if (platform === "TikTok") {
    for (const id of ["__UNIVERSAL_DATA_FOR_REHYDRATION__", "SIGI_STATE"]) {
      const tag = html.match(
        new RegExp(
          "<script[^>]*id=[\"\\']" +
            id +
            "[\"\\'][^>]*>([\\s\\S]*?)<\\/script>",
          "i",
        ),
      );
      if (!tag) continue;
      let j;
      try {
        j = JSON.parse(tag[1]);
      } catch {
        continue;
      }
      const items =
        id === "SIGI_STATE"
          ? Object.values(j.ItemModule || {})
          : [
              j.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo
                ?.itemStruct,
            ].filter(Boolean);
      for (const [itemIndex, item] of items.entries()) {
        const v = item.video;
        if (v) {
          for (const b of v.bitrateInfo || []) {
            const a = b.PlayAddr;
            for (const url of a?.UrlList?.slice(0, 1) || [])
              out.push({
                url,
                kind: "video",
                height: a.Height || 0,
                size: a.DataSize || null,
                label: "Video",
              });
          }
          const url =
            typeof v.playAddr === "string"
              ? v.playAddr
              : typeof v.downloadAddr === "string"
                ? v.downloadAddr
                : null;
          if (url)
            out.push({
              url,
              kind: "video",
              height: Number(v.height) || 0,
              label: "Video",
            });
        }
        for (const [imageIndex, im] of (
          item.imagePost?.images || []
        ).entries()) {
          const url = im.imageURL?.urlList?.[0];
          if (url)
            out.push({
              url,
              kind: "photo",
              label: "Image",
              itemId: `${itemIndex}:${imageIndex}`,
              original: true,
            });
        }
      }
    }
  }
  return out;
}
