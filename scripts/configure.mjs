import { writeFile, unlink, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const file = new URL("../tgcloud/endpoints/configure.js", import.meta.url);
await mkdir(new URL("../tgcloud/endpoints/", import.meta.url), {
  recursive: true,
});
const commands = [
  ["start", "Open Grand Downloader"],
  ["menu", "Open the main menu"],
  ["platforms", "Choose a source platform"],
  ["settings", "Manage download preferences"],
  ["language", "Change interface language"],
  ["history", "Review or delete your downloads"],
  ["help", "View supported capabilities"],
  ["cancel", "Cancel the current selection"],
  ["privacy", "Read data and owner access policy"],
].map(([command, description]) => ({ command, description }));
const source = `import {api} from 'sdk';
export default async function(){
 await api.setMyCommands({commands:${JSON.stringify(commands)}});
 await api.setMyDescription({description:'Download accessible public media with quality choices, English, Persian and Arabic menus, and private download history. Source availability varies; login, DRM and conversion are unsupported. The owner can review retained activity as explained in /privacy.'});
 await api.setMyShortDescription({short_description:'Public media downloader • English / فارسی / العربية • Source availability varies'});
 return {configured:true};
}`;
try {
  await writeFile(file, source, { flag: "wx" });
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/@tgcloud/cli/bin/tgcloud.js",
      "run",
      "endpoints/configure",
      "{}",
    ],
    { stdio: "inherit", cwd: new URL("../", import.meta.url) },
  );
  process.exitCode = r.status ?? 1;
} finally {
  await unlink(file);
}
