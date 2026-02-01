import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id").notNull(),
    creatorId: text("creator_id").notNull(),
    status: text("status").notNull().default("idle"),
    initialPrompt: text("initial_prompt").notNull(),
    acpSessionId: text("acp_session_id"),
    processPort: integer("process_port"),
    workingDir: text("working_dir").notNull(),
    docToken: text("doc_token"),
    workingMessageId: text("working_message_id"),
    isPlanMode: integer("is_plan_mode", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_sessions_chat_id").on(table.chatId),
    index("idx_sessions_thread_id").on(table.threadId),
    index("idx_sessions_status").on(table.status),
  ],
)

export const processedEvents = sqliteTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: text("processed_at").notNull(),
})
