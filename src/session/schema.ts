import { index, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    threadId: text("thread_id").notNull(),
    creatorId: text("creator_id").notNull(),
    status: text("status", { enum: ["idle", "running"] })
      .notNull()
      .default("idle"),
    initialPrompt: text("initial_prompt").notNull(),
    acpSessionId: text("acp_session_id"),
    workingDir: text("working_dir").notNull(),
    /** 飞书文档 token，用于注入 system prompt 上下文及 agent 读写文档 */
    docToken: text("doc_token"),
    /** 当前 streaming card 所在的飞书消息 ID，streaming 结束后清空 */
    workingMessageId: text("working_message_id"),
    mode: text("mode").notNull().default("default"),
    projectId: text("project_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_sessions_chat_id").on(table.chatId),
    index("idx_sessions_thread_id").on(table.threadId),
    index("idx_sessions_status").on(table.status),
    index("idx_sessions_project_id").on(table.projectId),
  ],
)

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    creatorId: text("creator_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    folderName: text("folder_name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_projects_chat_id").on(table.chatId)],
)

export const processedEvents = sqliteTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  processedAt: text("processed_at").notNull(),
})
