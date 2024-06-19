import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey(),

  goal: text("goal").notNull(),
  startingUrl: text("starting_url").notNull(),
  log: text("log"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at"),
  failedAt: text("failed_at"),
  output: text("output"),
  status: text("status").notNull().default("pending"),
  messages: text("messages"),
});
