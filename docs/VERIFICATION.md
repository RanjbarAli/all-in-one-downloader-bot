# Latest fix verification — 2026-10-16

The owner supplied Instagram post `DeimALUFbr3`. Actual local HTTP responses
showed a cropped 640×640 Open Graph preview with a crop transform, while the
public embed supplied a 1080×1350 source image with its original aspect ratio.
The cloud extractor found the full-aspect image (178,748 bytes). The actual
processURL handler sent it automatically to the owner without a quality prompt;
the saved delivery cursor completed one of one requested files. The Telegram
photo metadata was 1024×1280, preserving the full 4:5 aspect ratio (Telegram
resized/compressed the viewable photo; document mode preserves the source bytes).

Automated tests additionally cover 12-slide ordered extraction, complete delivery,
complete history replay, mixed photo/video collections, per-item quality choices,
Download all across selection pages, interrupted-delivery resume, and refusing
cropped-only/incomplete Instagram media. These collection-flow tests use a
mock SDK and do not establish live Instagram carousel availability.

# Verification and platform coverage

Actual cloud checks on 2026-10-16. These are sample results, not universal
claims. Tests used `tgcloud run` with real SDK, native DB and Bot API. Temporary
verification endpoints were removed before final deployment.

## Actual integration evidence

- CLI login, app ID, `getMe`: @granddl_bot (8858133958).
- Deployed schema migrations: users, activity and locks.
- Webhook synchronized for message and callback_query, no external server.
- Unauthorized owner-dashboard call rejected for a different numeric user ID.
- Owner dashboard and retained-record statistics sent successfully to 792399936.
- PNG at `https://www.w3.org/People/mimasa/test/imgformat/img/w3c_home.png`:
  public source resolved, 897-byte source, uploaded using InputFile, Telegram
  file ID stored. Actual successful media delivery, not a mocked upload.
- MP4 at `https://media.w3.org/2010/05/sintel/trailer.mp4`: MIME video/mp4,
  4,372,373 bytes, native URL delivery to the owner succeeded.
- Bot commands, short description and description configured via actual Bot API.
- A samplelib multipart-video trial returned HTTP 500/non-JSON from cloud; it
  is a failed trial, not successful evidence. Do not infer a memory/time limit
  from that one response. Native URL delivery was then verified with W3 MP4.

## Coverage matrix

| Source | Implemented behavior | Real sample status |
|---|---|---|
| Direct URLs | Approved-domain media, MIME/size checks, photo/video/audio or original document | PNG upload and MP4 native URL delivery verified; arbitrary domains intentionally blocked |
| Instagram | Public profile metadata, strict original-DP candidates; public post embed/carousels; conditional native Stories callback | Full-aspect supplied post delivered as original JPEG document (178,748 bytes). 100/320px profile thumbnails are now rejected. Native original-DP info returned 403; Stories feed returned no files despite active-story flag. No successful real original-DP/story claim |
| YouTube | Public player JSON only for unsigned complete MP4/audio; metadata previews | `jNQXAC9IVRw`: thumbnail available; no playable video/audio format exposed in this run. No verified video-download support |
| TikTok | Public embedded JSON video/image-post parser plus metadata | `@tiktok`: no accessible media in test; video download unverified |
| Facebook | Public metadata only | Untested; no supported-video claim |
| X / Twitter | Public metadata only | Untested; no guest-auth or video-playlist integration |
| Pinterest | Public metadata image/video | Untested; no profile pagination |
| Reddit | Public post JSON images/gallery/GIF, metadata fallback | r/pics sample restricted; individual post/gallery adapter only mocked/pending live verification |
| Threads | Public metadata only | Untested |
| Vimeo | Public progressive config files; metadata fallback | 76979871 returned preview image only, no usable progressive video |
| Dailymotion | Exposed MP4 qualities in public player metadata | x84sh87 restricted; no verified video-download support |
| Twitch | Public metadata only | Untested; HLS streams not supported |
| Snapchat | Public metadata only | Untested; no public-story collection adapter |
| Other sources | Explicitly approved direct media/CDN hosts only | No generic arbitrary-site downloader |

## Automated tests

`npm test`: pure and mocked HTTP tests distinguish logic verification from actual
platform checks. Covers rejected private/unsafe URLs, correct source matching,
quality and cap selection, metadata parsing, username validation, filenames,
translation completeness, stream byte caps, oversized early rejection, redirects,
HTML-player rejection, and preservation of exposed progressive quality sizes.

Not yet verified: production concurrency/load, 25 MiB multipart boundary, all
language screens by human native speakers, every received media type, strict
view/document replay preference changes, real multi-page owner navigation under
many user accounts, user cancellation during ongoing transfer, all social sites,
long-term URL expiry and file ID failures. There is no claim that local mocked
formats prove real Vimeo/TikTok/YouTube downloads.

## Original-brief features still unavailable

Full public profile details and post/reel pagination; reliable universal social
video download; playlist traversal; quality conversion or separate-track merging;
large-file splitting; arbitrary direct hosts; arbitrary file hosting; thumbnail
preference controls; configurable video/audio conversion formats; lifetime analytics
and operational feature toggles. Settings for nonexistent capabilities are absent.

The native downloader/admin foundation is deployed; DB-backed features are currently blocked by the datastore failure below. The full
universal product is **not production-certified**: broad social-media extraction
and production load/resource limits remain unverified or unsupported.

Initial automated result: **15 tests passed, 0 failed**, plus `npm run check`
passed. Initial CLI revision: **3**, with webhook in sync and no pending updates
at inspection. These revision numbers describe this handoff, not an ongoing
monitoring guarantee.

Latest automated result for full-aspect/carousel/automatic-send changes:
**29 tests passed, 0 failed**. `npm run check` passed. Temporary cloud test
endpoints were removed before deploying the changes.

## Numbered activity browsing / captions / simpler UI — 2026-10-16

40 automated tests passed, including 10,003 retained mock requests across 2,001
pages, a stable snapshot while a new request arrives, request-level Next/Prev
caption controls, missing-username fallback, sender isolation, nested `&#064;`
decoding, exposed post-author captions and the compact settings/reset flow.
These scale tests are in-memory SDK tests, not production cloud load tests.

Cloud verification encountered an unresolved native datastore failure: even
`db.get(sql\`SELECT 1 AS n\`)` and a parameterized constant query returned
`Sqlite error`, while Bot API getMe succeeded. The CLI migration inventory also
reported existing tables as new; a safe create-only migration attempt applied
zero changes and reported failure. No drops or data reset were performed.
Identity persistence was implemented using existing JSON columns instead, so
the release does not require a schema migration.

Temporary probe endpoints are removed before release. User-facing startup handles
a datastore failure with a short retry message. Live browsing verification is
pending native datastore recovery; local test passes are not a claim that the
cloud database issue is resolved.


## Original-file delivery / original DP / Stories — latest verification

- Actual native JPEG URL-to-document delivery of `DeimALUFbr3` succeeded:
  Telegram `file_size` matched source HEAD exactly, **178,748 bytes**, MIME JPEG.
  Original-file delivery avoids the earlier sendPhoto resize path. A 178 KB
  multipart JPEG trial returned cloud HTTP 500; this route is not proven reliable.
- Actual `ali_lionandsun` public metadata exposed profile name, biography, ID,
  counts and public/active-story flags. The web `profile_pic_url_hd` source is
  **320×320**, so it is rejected as an original DP. Native `/users/<id>/info/`
  returned **403**. No signature/resize URL rewrite is implemented.
- Actual unauthenticated native `/feed/reels_media/` returned **200 with empty
  reels**, despite the public active-story flag. The new View Stories callback
  ran in cloud and sent the access-restriction notice, **zero story files**.
- A real strict-profile flow sent public account information and the Stories
  callback without sending a small profile thumbnail. A final constant-SELECT
  health check still returned `Sqlite error`; the datastore failure is unresolved.
- **58 automated tests passed, 0 failed**. New mock tests cover all twelve
  stories across two pages, mixed image/video automatic delivery, largest image
  source, best existing video, deduplication, private accounts, rate-limit stop,
  incomplete pages/poster-only videos, and empty-feed restriction semantics.
  These are not successful real story/original-DP downloads.

The owner-only stateless fallback can deliver compatible full public media links
without saving history, with that limitation in captions. Public user flows fail
closed during the native database outage. No data reset or destructive migration
was attempted to hide the underlying failure.

Final release: **revision 6** deployed successfully. CLI reports no pending local
module changes; webhook is synchronized for message/callback_query with zero
pending updates at inspection. Formatting check passed. No verification endpoint
was deployed. The native database and Instagram access limitations above remain
unresolved.


## Untested follow-up — 2026-10-16

At the owner's explicit request, no automated or live-media tests were run for
this follow-up. Earlier 58-test results do not certify the current changes.

Changes: accept the largest known >=300×300 profile source (including web 320px),
read account-matched reels from public HTML, attempt the public Python-library
GraphQL shape before the native feed, support web video/display resources, and
keep the profile message intact when View Stories is clicked. Source research
is documented in INSTAGRAM-RESEARCH.md. Story accessibility remains conditional;
there is no new claim of a successful real story download.

Requested destructive reset: the actual native DELETE of activity failed with
`Sqlite error` before deleting any rows. Data clearing remains incomplete and
must be rerun after the native datastore recovers. No test data was exported into
the repository; only synthetic fixtures and non-secret configuration are included.

Follow-up deployed successfully as revision 7. No tests were run. The repository
contains a CLI-only data-clear script; a second actual reset attempt again failed
on the first DELETE with Sqlite error, so no clearing success is claimed.


## Current tested release — owner controls and strict >500px profile

The owner superseded the 300px requirement and explicitly requested testing.
**70 automated tests pass, zero failures**. Mock coverage includes owner menu
visibility during DB failure, direct Settings/history access, operational control
choices and persistence, rejecting non-owner changes/reset, a full three-table
purge, preserving operational policy during personal reset, best quality across
all collection items, replacing quality selection within an item, HTML story
owner matching, >200px story safeguards, and not editing the original profile
message on either Story success or error. These tests do not establish real
Instagram source availability or native database recovery.

Real native integration results (2026-10-16):

- A profile document was delivered to the configured owner before the latest
  >500px requirement. It was 20,571 bytes. Parsing the actual JPEG bytes confirmed
  **320×320**. This is earlier delivery evidence, not compliance with >500px.
- The current profile flow rejects that 320px source, sends available account
  information and reports that no >500px public image was found: **zero files**.
- The Stories callback ran against real public sources and sent an access notice,
  **zero story files**. Public story HTML had no media-resource fields; legacy
  GraphQL returned 400; web/native reel feeds returned empty collections.
  Native per-user story returned 403 and its web counterpart redirected.
- Alternative native-avatar-info on the web redirected; legacy public profile
  metadata request returned an empty 201 response. No authentication workaround
  or external downloader was introduced.
- Expanded owner menu and Service status were actually delivered via Bot API.
- Constant SELECT, database inventory and schema inventory all still failed with
  `Sqlite error`. A fresh safe migration attempt applied **0** changes and failed
  all three creates. The actual data-clear command failed on its first DELETE:
  existing cloud data remains **not cleared**. No logical reset success is claimed.

The bot is not production-ready while storage is unavailable. Settings/history
and public-user workflows remain blocked by that native service failure. The
strict >500px requirement and actual Instagram story delivery remain unfulfilled
for this account; the repository documents the failure rather than simulating it.

Final deployment: revision 8, webhook synchronized, zero pending updates at
inspection. The actual handlers/message /menu path ran successfully for owner
792399936 and delivered the updated menu. No temporary endpoint was deployed.
Formatting check passed; the final automated run passed all 70 tests.
