import { api } from "sdk";
import { guarded, dispatch } from "../lib/bot.js";
export default async function (q) {
  if (
    !q.from ||
    q.from.is_bot ||
    q.message?.chat?.type !== "private" ||
    q.message.chat.id !== q.from.id
  )
    return;
  await api.answerCallbackQuery({ callback_query_id: q.id });
  return guarded(
    q.from.id,
    (u) => dispatch(u, q.data || "", q.message.message_id),
    q.from,
    {
      allowStateless: [
        "menu",
        "cancel",
        "help",
        "privacy",
        "stories",
        "owner",
        "admin",
        "stats",
        "settings",
        "history",
        "advanced",
        "language",
      ].includes((q.data || "").split(":")[0]),
    },
  );
}
