import { desc, eq, lt } from "drizzle-orm"
import type { DrizzleDB } from "./db.js"
import type { CreateSessionParams, Session, SessionStatus } from "./types.js"
import { processedEvents, sessions } from "./schema.js"

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    chatId: row.chatId,
    threadId: row.threadId,
    creatorId: row.creatorId,
    status: row.status as SessionStatus,
    initialPrompt: row.initialPrompt,
    acpSessionId: row.acpSessionId ?? undefined,
    processPort: row.processPort ?? undefined,
    workingDir: row.workingDir,
    docToken: row.docToken ?? undefined,
    workingMessageId: row.workingMessageId ?? undefined,
    isPlanMode: row.isPlanMode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class SessionRepository {
  constructor(private db: DrizzleDB) {}

  async create(id: string, params: CreateSessionParams): Promise<Session> {
    const now = new Date().toISOString()
    await this.db.insert(sessions).values({
      id,
      chatId: params.chatId,
      threadId: params.threadId,
      creatorId: params.creatorId,
      status: "idle",
      initialPrompt: params.initialPrompt,
      workingDir: params.workingDir,
      docToken: params.docToken ?? null,
      isPlanMode: false,
      createdAt: now,
      updatedAt: now,
    })
    return (await this.findById(id))!
  }

  async findById(id: string): Promise<Session | null> {
    const row = await this.db.select().from(sessions).where(eq(sessions.id, id)).get()
    return row ? rowToSession(row) : null
  }

  async findByThreadId(threadId: string): Promise<Session | null> {
    const row = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.threadId, threadId))
      .orderBy(desc(sessions.createdAt))
      .limit(1)
      .get()
    return row ? rowToSession(row) : null
  }

  async findMostRecentByChatId(chatId: string): Promise<Session | null> {
    const row = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.chatId, chatId))
      .orderBy(desc(sessions.updatedAt))
      .limit(1)
      .get()
    return row ? rowToSession(row) : null
  }

  async findByChatId(chatId: string, limit?: number): Promise<Session[]> {
    const query = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.chatId, chatId))
      .orderBy(desc(sessions.createdAt))
    if (limit) {
      query.limit(limit)
    }
    const rows = await query.all()
    return rows.map(rowToSession)
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    const now = new Date().toISOString()
    await this.db.update(sessions).set({ status, updatedAt: now }).where(eq(sessions.id, id))
  }

  async updateAcpSessionId(id: string, acpSessionId: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db.update(sessions).set({ acpSessionId, updatedAt: now }).where(eq(sessions.id, id))
  }

  async updateWorkingMessageId(id: string, workingMessageId: string | null): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .update(sessions)
      .set({ workingMessageId, updatedAt: now })
      .where(eq(sessions.id, id))
  }

  async touch(id: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, id))
  }

  async updatePlanMode(id: string, isPlanMode: boolean): Promise<void> {
    const now = new Date().toISOString()
    await this.db.update(sessions).set({ isPlanMode, updatedAt: now }).where(eq(sessions.id, id))
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

  async deleteById(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id))
  }

  async cleanOldEvents(olderThanMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString()
    await this.db.delete(processedEvents).where(lt(processedEvents.processedAt, cutoff))
  }
}
