import { and, desc, eq, inArray, lt } from "drizzle-orm"
import type { DrizzleDB } from "./db.js"
import type { CreateTaskParams, Task, TaskStatus } from "./types.js"
import { processedEvents, tasks } from "./schema.js"

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    chatId: row.chatId,
    threadId: row.threadId,
    creatorId: row.creatorId,
    status: row.status as TaskStatus,
    prompt: row.prompt,
    summary: row.summary ?? undefined,
    sessionId: row.sessionId ?? undefined,
    processPort: row.processPort ?? undefined,
    workingDir: row.workingDir,
    docToken: row.docToken ?? undefined,
    cardMessageId: row.cardMessageId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
  }
}

export class TaskRepository {
  constructor(private db: DrizzleDB) {}

  async create(id: string, params: CreateTaskParams): Promise<Task> {
    const now = new Date().toISOString()
    await this.db.insert(tasks).values({
      id,
      chatId: params.chatId,
      threadId: params.threadId,
      creatorId: params.creatorId,
      status: "pending",
      prompt: params.prompt,
      workingDir: params.workingDir,
      docToken: params.docToken ?? null,
      createdAt: now,
      updatedAt: now,
    })
    return (await this.findById(id))!
  }

  async findById(id: string): Promise<Task | null> {
    const row = await this.db.select().from(tasks).where(eq(tasks.id, id)).get()
    return row ? rowToTask(row) : null
  }

  async findByThreadId(threadId: string): Promise<Task | null> {
    const row = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.threadId, threadId))
      .orderBy(desc(tasks.createdAt))
      .limit(1)
      .get()
    return row ? rowToTask(row) : null
  }

  async findByChatId(chatId: string, statuses?: TaskStatus[]): Promise<Task[]> {
    if (statuses && statuses.length > 0) {
      const rows = await this.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.chatId, chatId), inArray(tasks.status, statuses)))
        .orderBy(desc(tasks.createdAt))
        .all()
      return rows.map(rowToTask)
    }
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.chatId, chatId))
      .orderBy(desc(tasks.createdAt))
      .all()
    return rows.map(rowToTask)
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    extra?: Partial<
      Pick<Task, "summary" | "errorMessage" | "completedAt" | "sessionId">
    >,
  ): Promise<void> {
    const now = new Date().toISOString()
    const set: Record<string, unknown> = {
      status,
      updatedAt: now,
    }
    if (extra?.summary !== undefined) {
      set.summary = extra.summary
    }
    if (extra?.errorMessage !== undefined) {
      set.errorMessage = extra.errorMessage
    }
    if (extra?.completedAt !== undefined) {
      set.completedAt = extra.completedAt
    }
    if (extra?.sessionId !== undefined) {
      set.sessionId = extra.sessionId
    }
    await this.db.update(tasks).set(set).where(eq(tasks.id, id))
  }

  async updateSessionId(id: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .update(tasks)
      .set({ sessionId, updatedAt: now })
      .where(eq(tasks.id, id))
  }

  async updateProcessPort(id: string, port: number): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .update(tasks)
      .set({ processPort: port, updatedAt: now })
      .where(eq(tasks.id, id))
  }

  async updateCardMessageId(id: string, cardMessageId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .update(tasks)
      .set({ cardMessageId, updatedAt: now })
      .where(eq(tasks.id, id))
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    const row = await this.db
      .select()
      .from(processedEvents)
      .where(eq(processedEvents.eventId, eventId))
      .get()
    return row !== undefined
  }

  async markEventProcessed(eventId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .insert(processedEvents)
      .values({ eventId, processedAt: now })
      .onConflictDoNothing()
  }

  async cleanOldEvents(olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString()
    await this.db
      .delete(processedEvents)
      .where(lt(processedEvents.processedAt, cutoff))
  }
}
