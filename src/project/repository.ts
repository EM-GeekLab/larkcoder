import { desc, eq } from "drizzle-orm"
import type { DrizzleDB } from "../session/db"
import type { CreateProjectParams, Project, UpdateProjectParams } from "./types"
import { projects } from "../session/schema"

function rowToProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    chatId: row.chatId,
    creatorId: row.creatorId,
    title: row.title,
    description: row.description ?? undefined,
    folderName: row.folderName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export class ProjectRepository {
  constructor(private db: DrizzleDB) {}

  async create(id: string, params: CreateProjectParams): Promise<Project> {
    const now = new Date().toISOString()
    await this.db.insert(projects).values({
      id,
      chatId: params.chatId,
      creatorId: params.creatorId,
      title: params.title,
      description: params.description ?? null,
      folderName: params.folderName,
      createdAt: now,
      updatedAt: now,
    })
    return (await this.findById(id))!
  }

  async findById(id: string): Promise<Project | null> {
    const row = this.db.select().from(projects).where(eq(projects.id, id)).get()
    return row ? rowToProject(row) : null
  }

  async findByChatId(chatId: string, limit?: number): Promise<Project[]> {
    const query = this.db
      .select()
      .from(projects)
      .where(eq(projects.chatId, chatId))
      .orderBy(desc(projects.updatedAt))
    if (limit) {
      query.limit(limit)
    }
    const rows = query.all()
    return rows.map(rowToProject)
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id))
  }

  async update(id: string, params: UpdateProjectParams): Promise<void> {
    const now = new Date().toISOString()
    await this.db
      .update(projects)
      .set({
        title: params.title,
        description: params.description ?? null,
        folderName: params.folderName,
        updatedAt: now,
      })
      .where(eq(projects.id, id))
  }

  async touch(id: string): Promise<void> {
    const now = new Date().toISOString()
    await this.db.update(projects).set({ updatedAt: now }).where(eq(projects.id, id))
  }
}
