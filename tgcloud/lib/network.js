import { fetch } from "sdk";
import { instagramProfile, profileData } from "./profiles.js";
import { storyReel, htmlStoryReel, storyFormats } from "./stories.js";
import { instagramPost, instagramMedia } from "./instagram.js";
import { cleanText } from "./presentation.js";
import { MAX_ITEMS } from "./selection.js";
import {
  safeURL,
  MediaError,
  htmlFormats,
  detect,
  kindFor,
  embeddedFormats,
} from "./media.js";
export async function request(url, method = "GET", headers = {}) {
  for (let hop = 0; hop < 4; hop++) {
    safeURL(url);
    const r = await fetch(url, {
      method,
      redirect: "manual",
      headers: { "User-Agent": "GrandDL/1.0", Accept: "*/*", ...headers },
    });
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location");
      if (!location || hop === 3) throw new MediaError("redirect");
      const origin = url.match(/^https:\/\/[^/]+/)[0];
      url = location.startsWith("https://")
        ? location
        : location.startsWith("//")
          ? "https:" + location
          : location.startsWith("/")
            ? origin + location
            : url.split("?")[0].replace(/[^/]*$/, "") + location;
      safeURL(url);
      continue;
    }
    if (!r.ok) throw new MediaError(r.status === 429 ? "rate" : "restricted");
    if (r.url) safeURL(r.url);
    return r;
  }
  throw new MediaError("redirect");
}
export async function bounded(r, limit) {
  const size = Number(r.headers.get("content-length"));
  if (size > limit) throw new MediaError("large");
  const chunks = [];
  let n = 0;
  for await (const c of r.body) {
    n += c.length;
    if (n > limit) throw new MediaError("large");
    chunks.push(c);
  }
  const bytes = new Uint8Array(n);
  let p = 0;
  for (const c of chunks) {
    bytes.set(c, p);
    p += c.length;
  }
  return bytes;
}
export async function extract(url) {
  const platform = detect(url);
  let formats = [];
  let title = platform;
  let author = "";
  let collection = false;
  const post = platform === "Instagram" ? instagramPost(url) : null;
  const account = platform === "Instagram" ? instagramProfile(url) : null;
  let profile;
  if (account) {
    const data = await lookupInstagramProfile(account.username);
    profile = data.profile;
    author = profile.username;
    title = profile.name || "Instagram";
    formats = data.images.filter((f) => f.width >= 300 && f.height >= 300);
    if (!formats.length)
      return {
        platform,
        title,
        author,
        profile,
        formats: [],
        collection: false,
        itemCount: 0,
      };
  }
  if (post) {
    let result;
    for (const source of [
      post.canonical + "embed/captioned/",
      post.canonical,
    ]) {
      try {
        const r = await request(source);
        const html = new TextDecoder().decode(
          await bounded(r, 2 * 1024 * 1024),
        );
        result = instagramMedia(html, post.shortcode);
        if (result) break;
      } catch (e) {
        if (["incompleteCollection", "collectionLimit"].includes(e.code))
          throw e;
      }
    }
    if (!result) throw new MediaError("originalUnavailable");
    formats = result.formats;
    collection = result.collection;
    author = result.author || "";
  }
  if (platform === "Vimeo") {
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    if (id) {
      try {
        const r = await request(`https://player.vimeo.com/video/${id}/config`);
        const j = JSON.parse(
          new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
        );
        title = j.video?.title || title;
        for (const f of j.request?.files?.progressive || [])
          if (f.mime === "video/mp4")
            formats.push({
              url: f.url,
              kind: "video",
              height: f.height,
              label: f.quality || "Video",
            });
      } catch {}
    }
  }
  if (platform === "Dailymotion") {
    const id = url.match(/(?:video\/|dai.ly\/)([a-zA-Z0-9]+)/)?.[1];
    if (id) {
      const r = await request(
        `https://www.dailymotion.com/player/metadata/video/${id}`,
      );
      const j = JSON.parse(
        new TextDecoder().decode(await bounded(r, 1024 * 1024)),
      );
      title = j.title || title;
      for (const [q, items] of Object.entries(j.qualities || {}))
        for (const x of items)
          if (x.type === "video/mp4")
            formats.push({
              url: x.url,
              kind: "video",
              height: Number(q) || 0,
              label: q === "auto" ? "Video" : q + "p",
            });
    }
  }
  if (platform === "Reddit") {
    const clean = url.split("?")[0].replace(/\/$/, "");
    if (clean.includes("/comments/")) {
      const r = await request(clean + ".json?raw_json=1");
      const j = JSON.parse(
        new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
      );
      const p = j[0]?.data?.children?.[0]?.data;
      title = p?.title || title;
      const v = p?.secure_media?.reddit_video;
      if (v?.fallback_url)
        formats.push({
          url: v.fallback_url,
          kind: "video",
          height: v.height,
          label: "Video (no audio)",
          silent: !v.is_gif,
        });
      if (
        p?.url_overridden_by_dest &&
        /\.(png|jpe?g|gif)(\?|$)/i.test(p.url_overridden_by_dest)
      )
        formats.push({
          url: p.url_overridden_by_dest,
          kind: "photo",
          label: "Image",
        });
      collection = !!p?.gallery_data;
      for (const id of p?.gallery_data?.items?.map((x) => x.media_id) || []) {
        const x = p.media_metadata?.[id]?.s;
        if (x?.u)
          formats.push({
            url: x.u.replace(/&amp;/g, "&"),
            itemId: id,
            original: true,
            kind: "photo",
            label: "Image",
          });
      }
    }
  }
  if (!formats.length) {
    const r = await request(url);
    const type = (r.headers.get("content-type") || "").split(";")[0];
    const kind = kindFor(type, url);
    if (kind) {
      formats = [
        {
          url,
          kind,
          size: Number(r.headers.get("content-length")) || null,
          label: kind,
        },
      ];
    } else if (type.includes("html")) {
      const html = new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024));
      const embedded = embeddedFormats(html, platform);
      formats = embedded.length ? embedded : htmlFormats(html);
      title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || title;
    } else throw new MediaError("unsupported");
  }
  const seen = new Set();
  formats = formats.filter((f) => {
    try {
      safeURL(f.url);
      const key = (f.itemId ?? "main") + ":" + f.url;
      if (seen.has(key) || /\.(m3u8|mpd)(\?|$)/i.test(f.url)) return false;
      seen.add(key);
      return true;
    } catch {
      return false;
    }
  });
  if (formats.length > 200) throw new MediaError("collectionLimit");
  const checked = [];

  // Bounded parallel HEAD checks preserve source order, including all carousel items.
  for (let start = 0; start < formats.length; start += 4) {
    const batch = await Promise.all(
      formats.slice(start, start + 4).map(async (f) => {
        try {
          const head = await request(f.url, "HEAD");
          const type = (head.headers.get("content-type") || "").split(";")[0];
          if (
            !/^(image|video|audio)\//.test(type) ||
            kindFor(type, f.url) !== f.kind
          )
            return null;
          return {
            ...f,
            size: Number(head.headers.get("content-length")) || f.size || null,
          };
        } catch {
          return null;
        }
      }),
    );
    for (let i = 0; i < batch.length; i++) {
      if (batch[i]) checked.push(batch[i]);
    }
  }
  if (
    (collection ||
      new Set(
        formats.filter((f) => f.itemId !== undefined).map((f) => f.itemId),
      ).size > 1) &&
    formats.some((f) => !checked.some((x) => x.itemId === f.itemId))
  )
    throw new MediaError("incompleteCollection");
  if (!checked.length)
    throw new MediaError(post ? "originalUnavailable" : "restricted");
  if (profile) {
    checked.sort((a, b) => {
      const aa = a.width * a.height,
        bb = b.width * b.height;
      return aa && bb ? bb - aa : Number(b.hd) - Number(a.hd) || bb - aa;
    });
    const best = checked[0];
    checked.splice(0, checked.length, best);
    profile.photoWidth = best.width;
    profile.photoHeight = best.height;
  }
  const itemCount = new Set(
    checked.map((f) => f.itemId ?? (f.kind === "photo" ? f.url : "main")),
  ).size;
  if (itemCount > MAX_ITEMS) throw new MediaError("collectionLimit");
  return {
    platform,
    title: cleanText(title).slice(0, 200),
    author,
    profile,
    formats: checked,
    collection: collection || itemCount > 1,
    itemCount,
  };
}

export async function lookupInstagramProfile(
  username,
  { originalDP = true } = {},
) {
  const account = instagramProfile(
    "https://www.instagram.com/" + username + "/",
  );
  if (!account) throw new MediaError("invalid");
  const pages = [];
  for (const url of [account.url, account.url + "embed/"]) {
    try {
      const r = await request(url);
      pages.push(new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)));
    } catch (e) {
      if (e.code === "rate") throw e;
    }
  }
  const text = pages.join("\n").replace(/\\"/g, '"');
  const appId = text.match(/"(?:APP_ID|app_id)"\s*:\s*"(\d+)"/)?.[1];
  const extra = [];
  let rateLimited = false;
  if (appId) {
    const headers = { "X-IG-App-ID": appId, Accept: "application/json" };
    try {
      const r = await request(
        "https://www.instagram.com/api/v1/users/web_profile_info/?username=" +
          username,
        "GET",
        headers,
      );
      const j = JSON.parse(
        new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
      );
      const u = j.data?.user;
      if (u?.username?.toLowerCase() === username.toLowerCase()) {
        extra.push(u);
        if (
          originalDP &&
          u.is_private === false &&
          /^\d{1,30}$/.test(String(u.id))
        ) {
          try {
            const r = await request(
              "https://i.instagram.com/api/v1/users/" + u.id + "/info/",
              "GET",
              headers,
            );
            const j = JSON.parse(
              new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
            );
            if (j.user?.username?.toLowerCase() === username.toLowerCase())
              extra.push(j.user);
          } catch (e) {
            if (e.code === "rate") rateLimited = true;
          }
        }
      }
    } catch (e) {
      if (e.code === "rate") rateLimited = true;
    }
  }
  const data = profileData(username, pages, extra);
  return { ...data, appId, rateLimited, pages };
}
export async function extractStories(username) {
  const data = await lookupInstagramProfile(username, { originalDP: false });
  if (data.rateLimited) throw new MediaError("rate");
  const profile = data.profile;
  if (profile.isPrivate !== false) throw new MediaError("storiesRestricted");
  const source = "https://www.instagram.com/stories/" + username + "/";
  let initial = htmlStoryReel(data.pages, username, profile.id);
  if (!initial) {
    try {
      const r = await request(source);
      const html = new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024));
      initial = htmlStoryReel([html], username, profile.id);
    } catch (e) {
      if (e.code === "rate") throw e;
    }
  }
  if (!initial && /^\d{1,30}$/.test(profile.id || "")) {
    const variables = encodeURIComponent(
      JSON.stringify({ reel_ids: [profile.id], precomposed_overlay: false }),
    );
    try {
      const r = await request(
        "https://www.instagram.com/graphql/query/?query_hash=303a4ae99711322310f25250d988f3b7&variables=" +
          variables,
        "GET",
        {
          Accept: "application/json",
          ...(data.appId ? { "X-IG-App-ID": data.appId } : {}),
        },
      );
      const j = JSON.parse(
        new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
      );
      initial = storyReel([j], username, profile.id);
    } catch (e) {
      if (e.code === "rate") throw e;
    }
  }
  const formats = [];
  const seen = new Set();
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    let j = {};
    let reel = page === 0 ? initial : null;
    if (!reel && data.appId && /^\d{1,30}$/.test(profile.id || "")) {
      try {
        const url =
          "https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=" +
          profile.id +
          (cursor ? "&max_id=" + encodeURIComponent(cursor) : "");
        const r = await request(url, "GET", {
          "X-IG-App-ID": data.appId,
          Accept: "application/json",
        });
        j = JSON.parse(
          new TextDecoder().decode(await bounded(r, 2 * 1024 * 1024)),
        );
        reel = storyReel([j], username, profile.id);
      } catch (e) {
        if (e.code === "rate") throw e;
        throw new MediaError("storiesRestricted");
      }
    }
    if (!reel?.items?.length) {
      if (!formats.length)
        throw new MediaError(
          profile.hasPublicStory === false ? "noStories" : "storiesRestricted",
        );
      throw new MediaError("incompleteCollection");
    }
    const previous = seen.size;
    for (const item of reel.items) {
      const id = String(item.id || item.pk || "");
      if (!id) throw new MediaError("incompleteCollection");
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > MAX_ITEMS) throw new MediaError("collectionLimit");
      formats.push(...storyFormats(item, id));
    }
    if (formats.length > 200) throw new MediaError("collectionLimit");
    if (reel.more_available || j.more_available) {
      const next = reel.next_max_id || j.next_max_id;
      if (!next || seen.size === previous || page === 4)
        throw new MediaError("incompleteCollection");
      cursor = String(next);
      continue;
    }
    const checked = [];
    for (let start = 0; start < formats.length; start += 4) {
      const batch = await Promise.all(
        formats.slice(start, start + 4).map(async (f) => {
          try {
            safeURL(f.url);
            const r = await request(f.url, "HEAD");
            const mime = (r.headers.get("content-type") || "").split(";")[0];
            if (
              !/^(image|video)\//.test(mime) ||
              kindFor(mime, f.url) !== f.kind
            )
              return null;
            return {
              ...f,
              size: Number(r.headers.get("content-length")) || null,
            };
          } catch {
            return null;
          }
        }),
      );
      checked.push(...batch.filter(Boolean));
    }
    if ([...seen].some((id) => !checked.some((f) => f.itemId === id)))
      throw new MediaError("incompleteCollection");
    return {
      platform: "Instagram",
      title: "@" + username,
      author: username,
      source,
      formats: checked,
      collection: true,
      itemCount: seen.size,
    };
  }
  throw new MediaError("incompleteCollection");
}
