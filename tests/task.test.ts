import { beforeEach, describe, expect, it } from "bun:test"
import type { TaskRepository } from "../src/task/repository.js"
import type { CreateTaskParams, Task, TaskStatus } from "../src/task/types.js"
import { TaskService } from "../src/task/service.js"
import { TaskStateError } from "../src/utils/errors.js"
import { createLogger } from "../src/utils/logger.js"

/** In-memory mock that mirrors TaskRepository's async interface */
class MockTaskRepository implements Pick<
  TaskRepository,
  | "create"
  | "findById"
  | "findByThreadId"
  | "findByChatId"
  | "updateStatus"
  | "updateSessionId"
  | "updateProcessPort"
  | "updateCardMessageId"
  | "isEventProcessed"
  | "markEventProcessed"
  | "cleanOldEvents"
> {
  private tasks = new Map<string, Task>()
  private processedEvents = new Set<string>()

  async create(id: string, params: CreateTaskParams): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = {
      id,
      chatId: params.chatId,
      threadId: params.threadId,
      creatorId: params.creatorId,
      status: "pending",
      prompt: params.prompt,
      workingDir: params.workingDir,
      docToken: params.docToken,
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(id, task)
    return { ...task }
  }

  async findById(id: string): Promise<Task | null> {
    const task = this.tasks.get(id)
    return task ? { ...task } : null
  }

  async findByThreadId(threadId: string): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.threadId === threadId) {
        return { ...task }
      }
    }
    return null
  }

  async findByChatId(chatId: string, statuses?: TaskStatus[]): Promise<Task[]> {
    const results: Task[] = []
    for (const task of this.tasks.values()) {
      if (task.chatId === chatId) {
        if (!statuses || statuses.includes(task.status)) {
          results.push({ ...task })
        }
      }
    }
    return results
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    extra?: Partial<
      Pick<Task, "summary" | "errorMessage" | "completedAt" | "sessionId">
    >,
  ): Promise<void> {
    const task = this.tasks.get(id)
    if (!task) {
      return
    }
    task.status = status
    task.updatedAt = new Date().toISOString()
    if (extra?.summary !== undefined) {
      task.summary = extra.summary
    }
    if (extra?.errorMessage !== undefined) {
      task.errorMessage = extra.errorMessage
    }
    if (extra?.completedAt !== undefined) {
      task.completedAt = extra.completedAt
    }
    if (extra?.sessionId !== undefined) {
      task.sessionId = extra.sessionId
    }
  }

  async updateSessionId(id: string, sessionId: string): Promise<void> {
    const task = this.tasks.get(id)
    if (task) {
      task.sessionId = sessionId
      task.updatedAt = new Date().toISOString()
    }
  }

  async updateProcessPort(id: string, port: number): Promise<void> {
    const task = this.tasks.get(id)
    if (task) {
      task.processPort = port
      task.updatedAt = new Date().toISOString()
    }
  }

  async updateCardMessageId(id: string, cardMessageId: string): Promise<void> {
    const task = this.tasks.get(id)
    if (task) {
      task.cardMessageId = cardMessageId
      task.updatedAt = new Date().toISOString()
    }
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
const taskParams = {
  chatId: "chat_1",
  threadId: "thread_1",
  creatorId: "user_1",
  prompt: "hello",
  workingDir: "/tmp",
}

describe("TaskService", () => {
  let service: TaskService

  beforeEach(() => {
    const repo = new MockTaskRepository()
    service = new TaskService(repo as unknown as TaskRepository, logger)
  })

  it("creates a task with pending status", async () => {
    const task = await service.createTask(taskParams)
    expect(task.status).toBe("pending")
    expect(task.chatId).toBe("chat_1")
    expect(task.prompt).toBe("hello")
  })

  it("transitions pending → running", async () => {
    const task = await service.createTask(taskParams)
    const updated = await service.startTask(task.id)
    expect(updated.status).toBe("running")
  })

  it("transitions running → waiting", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    const updated = await service.setWaiting(task.id, "summary text")
    expect(updated.status).toBe("waiting")
  })

  it("transitions running → completed", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    const updated = await service.completeTask(task.id, "done")
    expect(updated.status).toBe("completed")
    expect(updated.completedAt).toBeDefined()
  })

  it("transitions running → failed", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    const updated = await service.failTask(task.id, "oops")
    expect(updated.status).toBe("failed")
  })

  it("transitions failed → running (retry)", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    await service.failTask(task.id, "oops")
    const updated = await service.startTask(task.id)
    expect(updated.status).toBe("running")
  })

  it("transitions waiting → running (continue)", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    await service.setWaiting(task.id)
    const updated = await service.startTask(task.id)
    expect(updated.status).toBe("running")
  })

  it("transitions pending → cancelled", async () => {
    const task = await service.createTask(taskParams)
    const updated = await service.cancelTask(task.id)
    expect(updated.status).toBe("cancelled")
  })

  it("rejects invalid transition: pending → completed", async () => {
    const task = await service.createTask(taskParams)
    expect(service.completeTask(task.id)).rejects.toThrow(TaskStateError)
  })

  it("rejects invalid transition: completed → running", async () => {
    const task = await service.createTask(taskParams)
    await service.startTask(task.id)
    await service.completeTask(task.id)
    expect(service.startTask(task.id)).rejects.toThrow(TaskStateError)
  })

  it("rejects invalid transition: cancelled → running", async () => {
    const task = await service.createTask(taskParams)
    await service.cancelTask(task.id)
    expect(service.startTask(task.id)).rejects.toThrow(TaskStateError)
  })

  it("handles event deduplication", async () => {
    expect(await service.isEventProcessed("evt_1")).toBe(false)
    await service.markEventProcessed("evt_1")
    expect(await service.isEventProcessed("evt_1")).toBe(true)
  })
})
