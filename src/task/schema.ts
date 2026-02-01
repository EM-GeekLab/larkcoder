import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id").notNull(),
    creatorId: text("creator_id").notNull(),
    status: text("status").notNull().default("pending"),
    prompt: text("prompt").notNull(),
    summary: text("summary"),
    sessionId: text("session_id"),
    processPort: integer("process_port"),
    workingDir: text("working_dir").notNull(),
    docToken: text("doc_token"),
    cardMessageId: text("card_message_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    completedAt: text("completed_at"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("idx_tasks_chat_id").on(table.chatId),
    index("idx_tasks_thread_id").on(table.threadId),
    index("idx_tasks_status").on(table.status),
  ],
)

export const processedEvents = sqliteTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: text("processed_at").notNull(),
})
