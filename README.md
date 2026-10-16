# Grand Downloader

Native Telegram Serverless bot: [@granddl_bot](https://t.me/granddl_bot).
Deployed to app8858133958. English default, Persian and Arabic UI. No external
backend, downloader service, paid extraction API, runtime npm dependency or local
always-on process.

This is a functioning **limited public-media downloader**, not a verified universal
social video downloader. See [support and real test evidence](docs/VERIFICATION.md).
The full original universal-downloader brief is **not fully achieved**. Do not
market all platform buttons as working video-download integrations.

## Use

Open the bot and press Start. Paste a public HTTPS URL or choose a platform first.
A single available file is sent automatically. Collections without quality choices
are sent in source order. When real alternatives exist, choose a quality, Auto
Best, selected items, or all items (up to 50). Large/slow collections retain a
resume cursor rather than silently stopping after three files.
A quality is shown only if exposed by the source, with MIME checked using HEAD.
Instagram post downloads use full-aspect public embed/structured media, not
cropped Open Graph previews. If full media or every slide cannot be accessed,
the bot reports that limitation.
Unknown sizes are bounded during download. Preview images are explicitly labelled
as images/previews; they do not establish video download support.

Settings persist: English / فارسی / العربية, preferred resolution, 5/10/25 MiB
threshold, viewable media vs original document, captions, and saved history.
History supports cached Telegram file reuse, repeat extraction if not cached,
individual deletion and clearing. Already sent messages are not remotely erased.

Owner account **792399936** sees User activity on the main menu and can use
`/admin`. It shows retained links, numeric user IDs, statuses and available
Telegram media. Next/Prev display target page numbers and the total. Five
requests are shown per page; opening a request puts numbered Next/Prev directly
on the last media attachment. Captions show the sender @username when available,
numeric ID and source link. Retained file IDs are reused. Authorization is checked for listing, media access and stats.
History-disabled or deleted records are not available to the owner. User media
uploads are recorded as Telegram file references when history is enabled.

## Develop and deploy

Use Node 24 for the test runner (the cloud runtime is isolated V8, not Node).

```sh
npm ci
npm test
npm run check
npx tgcloud login
npx tgcloud fetch
npx tgcloud status
npm run deploy
npm run migrate
npm run configure
npx tgcloud webhook
```

CLI login uses the **CLI access token**, not the Bot API token. Credentials remain
in CLI-managed ignored state; never commit or manually inspect `.tgcloud/`.
Alternatively supply `TGCLOUD_TOKEN` from a secret manager. No credential is
embedded in deployed modules. `configure` temporarily creates a local endpoint,
runs it through the CLI and deletes it. Do not deploy while it is running.

`push` and migrations are separate. `--safe` applies additions only. Never force
a conflicting revision or remove database columns to reset state. Review `fetch`
and `diff` before changing an existing cloud deployment.

## Code map

- `tgcloud/handlers/`: private-chat message and callback entry points.
- `tgcloud/lib/bot.js`: navigation, settings, sessions, history, owner tools, delivery.
- `tgcloud/lib/media.js`: URL safety, source detection, public metadata parsers,
  existing-quality selection. Never evaluates website JavaScript.
- `tgcloud/lib/network.js`: constrained HTTP, validated redirects, body caps,
  extractor adapters and MIME verification.
- `tgcloud/lib/i18n.js`: complete UI dictionaries, English fallback.
- `tgcloud/schema.js`: users, retained activity, per-user execution leases.
- `tests/`: pure logic and mocked network boundary tests; not integration claims.

See [runtime/security decisions](docs/ARCHITECTURE.md) and
[Persian handoff](docs/HANDOFF.fa.md).

## Latest interface update

The main menu and default settings are compact. Advanced preferences are under
More settings. Successful automatic downloads remove the temporary checking
message and do not add a separate completion message. Source captions decode
nested HTML entities, so `&#064;` becomes `@`.

Activity payloads now use `{version:1, username, files}` in the existing media
JSON column; legacy file arrays remain readable. Verified Telegram usernames
are cached in the existing preferences JSON as `_username`. This update needs
no database migration. Retention is 10,000 requests per user.

## Original photos and Instagram stories

Photos default to file/document delivery to avoid Telegram photo resizing. The
best exposed public post source is used without rewriting signed CDN URLs.
Instagram profile photos now require a source larger than 500 pixels in both
dimensions. The largest available eligible source is selected. A 320×320 web
source is rejected. Actual source resolution is shown. This does not label a resized web image as the original camera file.

View Stories creates a new status message and sends media in subsequent messages;
it never edits the profile message. It reads owner-matched story reels embedded
in public profile/story HTML, then attempts the public GraphQL shape used by
Python download libraries and the native exposed reels feed. It supports both
web GraphStoryImage/GraphStoryVideo resources and native image/video versions.
It follows up to five exposed feed pages and selects one best compatible version
per item. A maximum of 50 items/200 formats applies; missing items fail explicitly.
Stories absent from anonymous responses remain unavailable. No login, challenge
bypass, external service or Python runtime is added.

**Current operational limitation:** the native database returns `Sqlite error`,
even for a constant SELECT. History, settings and public-user flows await datastore
recovery. Only the configured owner has an explicit unsaved-download fallback;
its captions disclose that history was not saved. This is not production ready.

## Publishing this repository

This working tree includes source, documentation, branding and existing automated
tests. The current automated suite passes **70 tests**. Actual cloud testing found
only a 320×320 avatar for the sample account, so the strict >500px flow sends
account information and an unavailable notice instead. No successful real >500px
avatar or Instagram story download is claimed. See VERIFICATION.md.

Credentials, CLI state, cookies, sessions, database files and local logs are
excluded by `.gitignore`. Never force-add `.tgcloud/`. The numeric OWNER_ID in
`tgcloud/lib/config.js` is deployment configuration, not a secret; forks must
replace it with their own Telegram numeric account ID before deployment.

Create an empty GitHub repository, then connect and push from this directory:

```sh
git branch -M main
git remote add origin git@github.com:YOUR_ACCOUNT/granddl_bot.git
git push -u origin main
```

No remote publishing is performed by this project setup. For a fresh deployment,
follow Develop and deploy above using your own CLI credential.

## Clearing bot data

To delete all stored users, settings, workflow sessions, history, cached file
references and execution leases in the linked native database:

```sh
npm run data:clear -- --confirm-delete-all
```

The script runs a local CLI-only maintenance module and removes that module
in `finally`; never deploy while maintenance scripts are running. It does not
remove messages or attachments already delivered to Telegram chats, nor does it
claim deletion of service-side backups/logs that the SDK cannot manage. A failed
database call means the reset did not complete. The latest reset attempt failed
on the first DELETE with `Sqlite error`, so existing cloud data is **not cleared**.


## Owner menu and operational controls

The fixed numeric owner sees Settings, My downloads, Owner controls, User activity,
Statistics, Service status, quality preferences and language access on `/menu`.
Ordinary users do not see owner controls. The main menu avoids duplicate Settings
and history buttons. Owner identity remains 792399936 in config.js.

With healthy native storage, the owner can configure public download availability,
5/10/25 MiB global limits, 5/10/25/50 items per request, 2/5/10/30-second action
intervals, per-user retention, global history recording and per-platform switches.
Personal reset preserves these operational controls. Every control and global
reset rechecks the authenticated owner ID. The reset requires an explicit button
confirmation and checks that the three application tables are empty.

During the current native storage outage owner menu/status access remains available,
but history and saved controls show an availability notice. Settings are not falsely
reported as saved. Public users cannot bypass persisted rate controls via fallback.

Best quality applies to every item in a collection, and selecting a new quality
replaces the previous choice for that same item. Direct Instagram story links
route through the story extractor. View Stories keeps the original profile message
unchanged on both success and error. Stories at or below 200px or without known
usable dimensions are not passed off as full-size content.
