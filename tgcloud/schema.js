import { table, integer, text, index } from "sdk/db";
export const users = table("users", {
  id: integer("id").primaryKey(),
  lang: text("lang").notNull().default("en"),
  prefs: text("prefs").notNull().default("{}"),
  state: text("state").notNull().default("{}"),
  last: integer("last").notNull().default(0),
});
export const activity = table(
  "activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    source: text("source").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull(),
    media: text("media").notNull().default("[]"),
    created: integer("created").notNull(),
  },
  (t) => ({ userIdx: index("activity_user").on(t.userId, t.id) }),
);
export const locks = table("locks", {
  id: integer("id").primaryKey(),
  until: integer("until").notNull(),
});
