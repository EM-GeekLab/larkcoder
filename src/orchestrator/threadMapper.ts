import type { TaskService } from "../task/service.js"
import type { Task } from "../task/types.js"

export class ThreadMapper {
  constructor(private taskService: TaskService) {}

  async findTaskByThread(threadId: string): Promise<Task | null> {
    return this.taskService.getTaskByThread(threadId)
  }

  async findActiveTaskForThread(threadId: string): Promise<Task | null> {
    const task = await this.taskService.getTaskByThread(threadId)
    if (!task) {
      return null
    }
    if (task.status === "completed" || task.status === "cancelled") {
      return null
    }
    return task
  }
}
