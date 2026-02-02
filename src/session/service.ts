import { randomUUID } from "node:crypto"
import type { Logger } from "../utils/logger.js"
import type { SessionRepository } from "./repository.js"
import type { CreateSessionParams, Session, SessionStatus } from "./types.js"
import { SessionNotFoundError, SessionStateError } from "../utils/errors.js"

const validTransitions: Record<SessionStatus, SessionStatus[]> = {
  idle: ["running"],
  running: ["idle"],
}

export class SessionService {
  constructor(
    private repo: SessionRepository,
    private logger: Logger,
  ) {}

  async createSession(params: CreateSessionParams): Promise<Session> {
    const id = randomUUID()
    const session = await this.repo.create(id, params)
    this.logger.info(`Session created: ${session.id}`)
    return session
  }

  async getSession(id: string): Promise<Session> {
    const session = await this.repo.findById(id)
    if (!session) {
      throw new SessionNotFoundError(id)
    }
    return session
  }

  async findSessionForThread(threadId: string): Promise<Session | null> {
    return this.repo.findByThreadId(threadId)
  }

  async findSessionForChat(chatId: string): Promise<Session | null> {
    return this.repo.findMostRecentByChatId(chatId)
  }

  async listSessions(chatId: string, limit?: number): Promise<Session[]> {
    return this.repo.findByChatId(chatId, limit)
  }

  private transition(session: Session, nextStatus: SessionStatus): void {
    const allowed = validTransitions[session.status]
    if (!allowed?.includes(nextStatus)) {
      throw new SessionStateError(session.id, session.status, `transition to ${nextStatus}`)
    }
  }

  async setRunning(id: string): Promise<Session> {
    const session = await this.getSession(id)
    this.transition(session, "running")
    await this.repo.updateStatus(id, "running")
    this.logger.info(`Session ${id}: ${session.status} → running`)
    return this.getSession(id)
  }

  async setIdle(id: string): Promise<Session> {
    const session = await this.getSession(id)
    this.transition(session, "idle")
    await this.repo.updateStatus(id, "idle")
    this.logger.info(`Session ${id}: ${session.status} → idle`)
    return this.getSession(id)
  }

  async touchSession(id: string): Promise<void> {
    await this.repo.touch(id)
  }

  async setAcpSessionId(id: string, acpSessionId: string): Promise<void> {
    await this.repo.updateAcpSessionId(id, acpSessionId)
  }

  async setWorkingMessageId(id: string, messageId: string | null): Promise<void> {
    await this.repo.updateWorkingMessageId(id, messageId)
  }

  async deleteSession(id: string): Promise<void> {
    await this.repo.deleteById(id)
    this.logger.info(`Session deleted: ${id}`)
  }

  async setPlanMode(id: string, isPlanMode: boolean): Promise<void> {
    await this.repo.updatePlanMode(id, isPlanMode)
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.repo.isEventProcessed(eventId)
  }

  async markEventProcessed(eventId: string): Promise<void> {
    await this.repo.markEventProcessed(eventId)
  }
}
