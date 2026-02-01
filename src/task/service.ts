import { randomUUID } from "node:crypto"
import type { Logger } from "../utils/logger.js"
import type { TaskRepository } from "./repository.js"
import type { CreateTaskParams, Task, TaskStatus } from "./types.js"
import { TaskNotFoundError, TaskStateError } from "../utils/errors.js"

const validTransitions: Record<TaskStatus, TaskStatus[]> = {
  pending: ["running", "cancelled"],
  running: ["waiting", "completed", "failed", "cancelled"],
  waiting: ["running", "completed", "cancelled"],
  completed: [],
  failed: ["running"],
  cancelled: [],
}

export class TaskService {
  constructor(
    private repo: TaskRepository,
    private logger: Logger,
  ) {}

  async createTask(params: CreateTaskParams): Promise<Task> {
    const id = randomUUID()
    const task = await this.repo.create(id, params)
    this.logger.info(`Task created: ${task.id}`)
    return task
  }

  async getTask(id: string): Promise<Task> {
    const task = await this.repo.findById(id)
    if (!task) {
      throw new TaskNotFoundError(id)
    }
    return task
  }

  async getTaskByThread(threadId: string): Promise<Task | null> {
    return this.repo.findByThreadId(threadId)
  }

  private transition(task: Task, nextStatus: TaskStatus): void {
    const allowed = validTransitions[task.status]
    if (!allowed?.includes(nextStatus)) {
      throw new TaskStateError(
        task.id,
        task.status,
        `transition to ${nextStatus}`,
      )
    }
  }

  async startTask(id: string): Promise<Task> {
    const task = await this.getTask(id)
    this.transition(task, "running")
    await this.repo.updateStatus(id, "running")
    this.logger.info(`Task ${id}: ${task.status} → running`)
    return this.getTask(id)
  }

  async setWaiting(id: string, summary?: string): Promise<Task> {
    const task = await this.getTask(id)
    this.transition(task, "waiting")
    await this.repo.updateStatus(id, "waiting", { summary })
    this.logger.info(`Task ${id}: ${task.status} → waiting`)
    return this.getTask(id)
  }

  async completeTask(id: string, summary?: string): Promise<Task> {
    const task = await this.getTask(id)
    this.transition(task, "completed")
    await this.repo.updateStatus(id, "completed", {
      summary,
      completedAt: new Date().toISOString(),
    })
    this.logger.info(`Task ${id}: ${task.status} → completed`)
    return this.getTask(id)
  }

  async failTask(id: string, errorMessage: string): Promise<Task> {
    const task = await this.getTask(id)
    this.transition(task, "failed")
    await this.repo.updateStatus(id, "failed", { errorMessage })
    this.logger.info(`Task ${id}: ${task.status} → failed`)
    return this.getTask(id)
  }

  async cancelTask(id: string): Promise<Task> {
    const task = await this.getTask(id)
    this.transition(task, "cancelled")
    await this.repo.updateStatus(id, "cancelled")
    this.logger.info(`Task ${id}: ${task.status} → cancelled`)
    return this.getTask(id)
  }

  async setSessionId(id: string, sessionId: string): Promise<void> {
    await this.repo.updateSessionId(id, sessionId)
  }

  async setProcessPort(id: string, port: number): Promise<void> {
    await this.repo.updateProcessPort(id, port)
  }

  async setCardMessageId(id: string, messageId: string): Promise<void> {
    await this.repo.updateCardMessageId(id, messageId)
  }

  async getTasksByChatId(chatId: string): Promise<Task[]> {
    return this.repo.findByChatId(chatId)
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.repo.isEventProcessed(eventId)
  }

  async markEventProcessed(eventId: string): Promise<void> {
    await this.repo.markEventProcessed(eventId)
  }
}
