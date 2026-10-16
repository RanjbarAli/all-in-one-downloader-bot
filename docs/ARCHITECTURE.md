# Runtime, security and maintenance

Reviewed 2026-10-16, Asia/Muscat.

Sources: [Telegram Serverless documentation](https://blogfork.telegram.org/bots/serverless),
CLI 0.2.0 scaffold's [SDK reference](tgcloud-sdk.md), and
[Telegram Bot API file delivery rules](https://core.telegram.org/bots/api#sending-files).
The Serverless page returned by the documentation search is on Telegram's
blogfork.telegram.org host; core.telegram.org/bots/serverless was not accessible
through the research tool. Installed CLI documentation and actual cloud runs
were used to verify API behavior rather than relying only on that page.

## Verified environment

Only project JS and `sdk` imports run in cloud. SDK supplies SQLite, Bot API,
HTTP streaming and InputFile. No npm packages, Node filesystem, child processes
or executable FFmpeg. Runtime probes confirmed TextDecoder and crypto, and no
URL or AbortController globals. URL validation therefore uses a deliberately
narrow HTTPS grammar. There is no documented verified wall-clock, heap, CPU,
network-quota or database-size figure in the SDK reference available here.
**25 MiB is an application target, not a measured cloud memory guarantee.**
A full buffered file involves chunks plus a combined array plus SDK overhead.
A 25 MiB boundary integration load test has not passed or been claimed.

Bot API limits and sandbox resource limits are separate. The reference describes
50 MB multipart uploads (10 MB photos), 20 MB Bot API file download, and native
URL delivery limits of 20 MB (5 MB photos). Cached `file_id` reuse avoids downloading
and uploading bytes and keeps the original Telegram media type. Native URL
sending is used for HEAD-verified compatible photo/video/audio below those limits
and the user's threshold. If Telegram rejects URL delivery with 400, bounded
multipart is attempted. JPEG original documents also use native URL delivery when HEAD reports a known
size within 20 MB and the user cap: an actual 178,748-byte JPEG was delivered
with matching Telegram size. This is a narrow observed capability; official
Bot API docs describe URL documents for PDF/ZIP, so other MIME types retain
bounded byte delivery and the JPEG path falls back on HTTP 400. File IDs can exceed our ordinary
transfer threshold because no bytes pass through our runtime; this is useful
for user-submitted Telegram files.

A source may change after HEAD: known-size native URL delivery cannot provide a
strict byte guarantee against a source that lies or changes between requests.
Use document/multipart mode for a strict read cap. Unknown-size delivery always
uses bounded reads. Telegram handles viewable-photo resizing; choose document
for original bytes. No arbitrary compression, remuxing, transcoding, file-part
assembly, or hosted generated-file service exists in this implementation.
Oversized/unsupported options link to the original source. Source URLs may expire.

## Input and network boundary

HTTPS only, no credentials, custom ports, whitespace, backslashes, literal IPs,
localhost, arbitrary hosts or suffix tricks. Allowed sources and CDN suffixes
are explicit in `media.js`. This intentionally restricts arbitrary direct URLs.
Adding a CDN requires a code review. Short-link redirects are limited to three
hops, checked before each next request. `redirect: manual` returned 301 in an
actual cloud request (samplelib test); final response URL is also checked.
The SDK docs describe automatic redirect behavior generally, so changes to its
manual-redirect implementation must be retested. We cannot inspect DNS answers,
pin addresses or enforce the platform's internal egress policy; DNS rebinding
and a future SDK redirect behavior change are residual SSRF risks. The allowlist
limits these risks but is not an IP-layer guarantee.

HTML/JSON reads cap at 1–2 MiB; at most 200 candidate HEAD checks in batches of four, with at most 50
media items per collection. Selected-quality screens paginate eight formats at
a time; Download all uses the entire collection, not only the displayed page.
Delivery saves a per-item cursor and cached file reference; slow batches yield
a Continue button after 20 seconds. This does not schedule background work. No unbounded retries or jobs. No content
is executed, no authentication/cookies or passwords requested. HLS/DASH playlists,
DRM, signature-cipher formats and separate video-only tracks are not offered as
complete videos. Audio-only source files can be delivered without conversion.

## Authorization and persistence

Only private chats where sender ID equals chat ID are accepted. Owner identity
is a fixed numeric account ID, never first-user claiming or a username. Owner
checks are repeated on every privileged operation. User history queries and
mutations include the authenticated numeric ID. Callbacks use the current user's
state; format buttons include a generation timestamp and expire after 15 minutes.
No public Mini App endpoint is deployed.

Each user has a persisted 120-second lease, atomically acquired in SQLite, plus a
1.5-second minimum operation interval. Concurrent actions during a lease are
acknowledged and ignored. An in-flight Bot API upload cannot be cancelled; Cancel
clears the pending selection once the prior action finishes. There is no background
queue. Lease expiry is an operational fallback, not proof that a previous invocation
has terminated. Repeated Telegram update delivery is not globally deduplicated;
a retried update after a completed lease can repeat an operation.

Users contain ID, language, prefs and one workflow. Activity stores public source,
platform, status, timestamp and Telegram file references, not media blobs or real display names. Telegram usernames are retained for
owner captions and disclosed in the privacy text. Each user retains at most 10,000 activity rows, with a user/id index declared
in schema. Aggregate stats cover retained records, not lifetime analytics. Global
DB/user count is not bounded by app policy; monitor Telegram quotas as usage grows.

History-disabled users do not create new activity; clearing/deleting removes owner
access to those records. Selection state is logically expired at 15 minutes but
is not physically TTL-deleted without a later action; Clear/Cancel removes it.
No cron scheduler or unsupported background cleanup is assumed. Privacy disclosure
is sent on /start and available through /privacy. Owner previews send media only
when the owner presses View media; no automatic forwarding to other accounts.

## Adapters and failure handling

Vimeo config and Dailymotion metadata accept only exposed progressive MP4 files.
Reddit public JSON supports exposed images/gallery and GIF video; audio-less ordinary
video tracks are unavailable. YouTube public player JSON supports only already
unsigned complete MP4 URLs and audio-only URLs. TikTok public JSON supports exposed
playable files and image posts. All other listed sites have a generic public
Open Graph adapter. A webpage or embedded HTML player is never a downloadable video.
These parsers have conditional support, not blanket working-platform guarantees.

External fetch, Telegram and parser failures show localized recovery text without
raw URLs/tokens or exception dumps. Failed extraction is retained as activity when
history is enabled. Source error categories are summarized, not logged with bodies.
There is no fabricated progress. The initial checking message can remain if a
platform hard timeout interrupts the invocation; a new request works after lease
expiry. User and owner browse UI currently shares retained request records.

## Full-aspect posts and automatic delivery (2026-10-16 update)

Instagram /p/, /reel/ and /tv/ public post URLs are normalized for public embed
requests, without cookies, login APIs, signature rewriting or third-party services.
Structured carousel children are read in source order; existing quality versions
share an item ID. Static public embed images use the supplied full-aspect src/srcset
URL. Square og:image is not substituted if the original cannot be found.
A sidecar flag without its children or a failed slide MIME check fails explicitly.
The reader does not claim to fetch authenticated/profile pagination or hidden slides.

One usable variant per item triggers automatic delivery of every item. Multiple
usable variants of one item retain quality selection. Preview thumbnails are not
extra slides when actual media exists. Each successful upload persists progress;
Continue starts with the next item. The Bot API send and local state save are
not atomic, so a crash between them can still cause an occasional duplicate.
Cached history now retains and replays up to all 50 files rather than three.

## Activity browsing and identity metadata

Activity/history lists use bounded five-row queries, numbered Next/Prev and a
COUNT rather than loading all rows. The callback carries the newest visible ID
as a snapshot boundary: newly arriving requests do not shift records between
pages until Refresh. Offset queries use the primary-key order (and the declared
user/id index for personal history); counts are exact over retained rows, not
lifetime requests. Removing records can reduce/clamp the last page.

Request-level owner navigation uses neighboring IDs and an exact ordinal count.
Only the final attachment carries navigation for multi-file requests. Owner
captions include the sender username, numeric ID and submitted source; normal
captions include an exposed source author handle and source link. Users without
a username display only their ID. Older missing usernames may be resolved through
Bot API getChat on owner preview and cached; this is a current handle, not proof
of the account's historical handle.

The existing users.prefs JSON stores a server-set `_username`; activity.media
accepts versioned `{version:1, username, files}` records as well as legacy arrays.
No new columns are needed. Sender identity comes from the verified Telegram update;
none of the preferences buttons can set `_username`. Nested HTML entities are
decoded at rendering time with bounded passes and no parse_mode interpolation.

A native datastore outage is handled outside the lease acquisition too, giving
a short retry message instead of silently failing before entering the handler.


## Instagram profile and story boundary

Profile lookup reads public page/embed data and its public application identifier,
then attempts unauthenticated public profile metadata and native user info. No
social tokens, cookies or login are used. The largest exposed avatar with known dimensions of at least 300×300 is
eligible, including the observed 320px web HD source. Explicit native
`hd_profile_pic_url_info` / `hd_profile_pic_versions` remain preferred when larger.
The source resolution is disclosed; no signed-URL transform removal is attempted.

The Stories callback looks up the same account, requires an explicitly public
profile and numeric ID, and reads exposed reels media. It follows at most five
explicit pagination cursors, deduplicates IDs, checks every item and rejects
missing video tracks rather than sending their posters. HEAD checks run four at
a time. All exposed items (max 50, 200 formats) use existing best-compatible-file
selection and the ordinary resumable delivery cursor. An empty feed with active
or unknown stories is restricted access, not proof that no stories exist.
Actual original-DP and story delivery remain unverified; mocked tests verify
parser, pagination, selection and callback behavior only.

During a native DB outage only the fixed owner may use an explicit stateless
public-link/Stories fallback. Public accounts fail closed so persisted leases and
rate controls are not bypassed. Unsaved captions disclose absent history; volatile
collections cannot persist a continuation cursor. Large multipart cloud failures
remain unresolved; URL delivery avoids that path only for verified compatible
files and does not establish arbitrary 25 MiB upload reliability.


Latest revision adds owner-matched HTML reel parsing and a bounded public GraphQL
fallback based on the public shapes used by Python libraries. It never treats
arbitrary image tags or timeline posts as story files. View Stories creates a
new message; its status/error edits target only that new message. Current changes
were not tested at the owner's request.

The CLI-only data reset script deletes activity, locks and users in order. This
SDK documents no atomic multi-table reset; a later failure can leave a partial
reset. A failure on the first DELETE in the actual attempt removed no rows. No
reset endpoint is deployed and credentials remain in ignored CLI machine state.
