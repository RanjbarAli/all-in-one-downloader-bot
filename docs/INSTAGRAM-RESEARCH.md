# Instagram extraction research — 2026-10-16

Reviewed primary maintainer documentation and source; no Python runtime is added
to the native Telegram V8 application. This is a design review, not a live-media
test or a guarantee that Instagram exposes content anonymously.

- [Instaloader Profile source](https://github.com/instaloader/instaloader/blob/master/instaloader/structures.py):
  its avatar property uses native `hd_profile_pic_url_info` when a logged-in
  mobile context exists; otherwise it falls back to `profile_pic_url_hd`.
  The web field may be a resized image. The latest owner minimum accepts only sources above 500px in both dimensions
  and reports actual dimensions without claiming upscaling.
- [Instaloader get_stories](https://github.com/instaloader/instaloader/blob/master/instaloader/instaloader.py):
  decorated as requiring login; retrieves reels through GraphQL. Story resources
  use `display_resources` and `video_resources`, not arbitrary HTML image tags.
- [instagrapi story mixin](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/story.py):
  public GraphQL requests use reel IDs and the reels-media query, copying an
  existing session if available. Its anonymous path can fail, and its private
  fallback requires login. The app attempts the same public response shape
  without injecting credentials or using third-party downloader services.
- [instagrapi user mixin](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/user.py):
  public profile metadata can be rate limited or session gated. Public naming
  does not promise every response is anonymously accessible.

Implementation reads JSON script roots, shared-data/additional-data payloads and
nested contextJSON without evaluating scripts. It accepts only reel containers
matching the target username/ID, supports both web and native story media fields,
and enforces existing SSRF, byte, item, format and pagination caps. Public profile
privacy must be explicitly false. No login/CAPTCHA/DRM/private-account bypass is
implemented. An active-story flag alone never proves downloadable story files.

Subsequent testing was explicitly requested by the owner and performed. The
320×320 source was actually sent and its JPEG bytes independently parsed to
confirm dimensions; the newer >500px rule now rejects it. For this account the
public story HTML exposed no story resources, the legacy GraphQL query returned
400, both native/web reels endpoints returned empty reels, the web single-user
story path redirected and the native single-user story path returned 403. The
web native-avatar-info path redirected; the legacy __a profile request returned
201 with no metadata. These outcomes do not prove unrestricted anonymous access.
No successful real >500px profile or story download is claimed.
