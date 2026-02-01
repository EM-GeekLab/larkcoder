import { beforeEach, describe, expect, it } from "bun:test"
import type { SessionRepository } from "../src/session/repository.js"
import type { CreateSessionParams, Session, SessionStatus } from "../src/session/types.js"
import { SessionService } from "../src/session/service.js"
import { SessionNotFoundError, SessionStateError } from "../src/utils/errors.js"
import { createLogger } from "../src/utils/logger.js"

class MockSessionRepository implements Pick<
  SessionRepository,
  | "create"
  | "findById"
  | "findByThreadId"
  | "findMostRecentByChatId"
  | "findByChatId"
  | "updateStatus"
  | "updateAcpSessionId"
  | "updateWorkingMessageId"
  | "updatePlanMode"
  | "isEventProcessed"
  | "markEventProcessed"
  | "deleteById"
  | "cleanOldEvents"
> {
  private sessions = new Map<string, Session>()
  private processedEvents = new Set<string>()

  async create(id: string, params: CreateSessionParams): Promise<Session> {
    const now = new Date().toISOString()
    const session: Session = {
      id,
      chatId: params.chatId,
      threadId: params.threadId,
      creatorId: params.creatorId,
      status: "idle",
      initialPrompt: params.initialPrompt,
      workingDir: params.workingDir,
      docToken: params.docToken,
      isPlanMode: false,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(id, session)
    return { ...session }
  }

  async findById(id: string): Promise<Session | null> {
    const session = this.sessions.get(id)
    return session ? { ...session } : null
  }

  async findByThreadId(threadId: string): Promise<Session | null> {
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId) {
        return { ...session }
      }
    }
    return null
  }

  async findMostRecentByChatId(chatId: string): Promise<Session | null> {
    let latest: Session | null = null
    for (const session of this.sessions.values()) {
      if (session.chatId === chatId) {
        if (!latest || session.createdAt > latest.createdAt) {
          latest = session
        }
      }
    }
    return latest ? { ...latest } : null
  }

  async findByChatId(chatId: string, _limit?: number): Promise<Session[]> {
    const results: Session[] = []
    for (const session of this.sessions.values()) {
      if (session.chatId === chatId) {
        results.push({ ...session })
      }
    }
    return results
  }

  async updateStatus(id: string, status: SessionStatus): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.status = status
      session.updatedAt = new Date().toISOString()
    }
  }

  async updateAcpSessionId(id: string, acpSessionId: string): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.acpSessionId = acpSessionId
      session.updatedAt = new Date().toISOString()
    }
  }

  async updateWorkingMessageId(id: string, workingMessageId: string | null): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.workingMessageId = workingMessageId ?? undefined
      session.updatedAt = new Date().toISOString()
    }
  }

  async updatePlanMode(id: string, isPlanMode: boolean): Promise<void> {
    const session = this.sessions.get(id)
    if (session) {
      session.isPlanMode = isPlanMode
      session.updatedAt = new Date().toISOString()
    }
  }

  async deleteById(id: string): Promise<void> {
    this.sessions.delete(id)
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId)
  }

  async markEventProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId)
  }

  async cleanOldEvents(_olderThanMs: number): Promise<void> {}
}

const logger = createLogger({ prefix: "test" })
const sessionParams: CreateSessionParams = {
  chatId: "chat_1",
  threadId: "thread_1",
  creatorId: "user_1",
  initialPrompt: "hello",
  workingDir: "/tmp",
}

describe("SessionService", () => {
  let service: SessionService

  beforeEach(() => {
    const repo = new MockSessionRepository()
    service = new SessionService(repo as unknown as SessionRepository, logger)
  })

  it("creates a session with idle status", async () => {
    const session = await service.createSession(sessionParams)
    expect(session.status).toBe("idle")
    expect(session.chatId).toBe("chat_1")
    expect(session.initialPrompt).toBe("hello")
    expect(session.isPlanMode).toBe(false)
  })

  it("transitions idle → running", async () => {
    const session = await service.createSession(sessionParams)
    const updated = await service.setRunning(session.id)
    expect(updated.status).toBe("running")
  })

  it("transitions running → idle", async () => {
    const session = await service.createSession(sessionParams)
    await service.setRunning(session.id)
    const updated = await service.setIdle(session.id)
    expect(updated.status).toBe("idle")
  })

  it("rejects invalid transition: idle → idle", async () => {
    const session = await service.createSession(sessionParams)
    expect(service.setIdle(session.id)).rejects.toThrow(SessionStateError)
  })

  it("rejects invalid transition: running → running", async () => {
    const session = await service.createSession(sessionParams)
    await service.setRunning(session.id)
    expect(service.setRunning(session.id)).rejects.toThrow(SessionStateError)
  })

  it("finds session by thread", async () => {
    await service.createSession(sessionParams)
    const found = await service.findSessionForThread("thread_1")
    expect(found).not.toBeNull()
    expect(found!.chatId).toBe("chat_1")
  })

  it("finds session by chat", async () => {
    await service.createSession(sessionParams)
    const found = await service.findSessionForChat("chat_1")
    expect(found).not.toBeNull()
    expect(found!.threadId).toBe("thread_1")
  })

  it("lists sessions by chat", async () => {
    await service.createSession(sessionParams)
    await service.createSession({
      ...sessionParams,
      threadId: "thread_2",
      initialPrompt: "world",
    })
    const sessions = await service.listSessions("chat_1")
    expect(sessions).toHaveLength(2)
  })

  it("sets plan mode", async () => {
    const session = await service.createSession(sessionParams)
    await service.setPlanMode(session.id, true)
    const updated = await service.getSession(session.id)
    expect(updated.isPlanMode).toBe(true)
  })

  it("sets ACP session ID", async () => {
    const session = await service.createSession(sessionParams)
    await service.setAcpSessionId(session.id, "acp-123")
    const updated = await service.getSession(session.id)
    expect(updated.acpSessionId).toBe("acp-123")
  })

  it("sets and clears working message ID", async () => {
    const session = await service.createSession(sessionParams)
    await service.setWorkingMessageId(session.id, "msg-123")
    let updated = await service.getSession(session.id)
    expect(updated.workingMessageId).toBe("msg-123")

    await service.setWorkingMessageId(session.id, null)
    updated = await service.getSession(session.id)
    expect(updated.workingMessageId).toBeUndefined()
  })

  it("deletes a session", async () => {
    const session = await service.createSession(sessionParams)
    await service.deleteSession(session.id)
    expect(service.getSession(session.id)).rejects.toThrow(SessionNotFoundError)
  })

  it("handles event deduplication", async () => {
    expect(await service.isEventProcessed("evt_1")).toBe(false)
    await service.markEventProcessed("evt_1")
    expect(await service.isEventProcessed("evt_1")).toBe(true)
  })
})
