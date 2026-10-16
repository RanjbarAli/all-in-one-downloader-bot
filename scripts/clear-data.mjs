import { mkdir, writeFile, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// Deliberately destructive and CLI-only. Never deploy this temporary module.
if (!process.argv.includes("--confirm-delete-all")) {
  console.error(
    "Deletes ALL bot users, preferences, sessions, history and leases.\nRun npm run data:clear -- --confirm-delete-all only for the linked bot you intend to reset.",
  );
  process.exit(1);
}
const file = new URL("../tgcloud/endpoints/purgeTestData.js", import.meta.url);
await mkdir(new URL("../tgcloud/endpoints/", import.meta.url), {
  recursive: true,
});
const source = `import { db } from 'sdk';
import { users, activity, locks } from '../schema.js';
export default async function () {
 const removed = {};
 for (const [name, table] of [['activity',activity],['locks',locks],['users',users]]) {
  removed[name] = (await db.delete(table).run()).rowsAffected;
 }
 return {cleared:true,removed};
}`;
let created = false;
try {
  await writeFile(file, source, { flag: "wx" });
  created = true;
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/@tgcloud/cli/bin/tgcloud.js",
      "run",
      "endpoints/purgeTestData",
      "{}",
    ],
    { stdio: "inherit", cwd: new URL("../", import.meta.url) },
  );
  process.exitCode = r.status ?? 1;
} finally {
  if (created) await unlink(file);
}
