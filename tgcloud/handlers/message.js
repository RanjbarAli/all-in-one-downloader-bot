import { guarded, receive } from "../lib/bot.js";
export default async function (m) {
  if (
    m.chat?.type !== "private" ||
    !m.from ||
    m.from.is_bot ||
    m.chat.id !== m.from.id
  )
    return;
  return guarded(m.from.id, (u) => receive(u, m), m.from, {
    allowStateless: true,
  });
}
