import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import type { Logger } from "../utils/logger"
import type { ProjectRepository } from "./repository"
import type { CreateProjectParams, Project, UpdateProjectParams } from "./types"
import { ProjectNotFoundError } from "../utils/errors"

const ILLEGAL_CHARS = /[/\\:*?"<>|]/

function validateFolderName(name: string): string | null {
  if (!name || !name.trim()) {
    return "Folder name cannot be empty."
  }
  if (name === "." || name === "..") {
    return 'Folder name cannot be "." or "..".'
  }
  if (ILLEGAL_CHARS.test(name) || name.includes("\x00")) {
    return "Folder name contains illegal characters."
  }
  return null
}

export class ProjectService {
  constructor(
    private repo: ProjectRepository,
    private baseWorkingDir: string,
    private logger: Logger,
  ) {}

  async createProject(params: CreateProjectParams): Promise<Project> {
    const id = randomUUID()
    const project = await this.repo.create(id, params)

    const dir = this.getProjectWorkingDir(project)
    mkdirSync(dir, { recursive: true })

    this.logger
      .withMetadata({ projectId: project.id, folderName: project.folderName })
      .info("Project created")
    return project
  }

  async getProject(id: string): Promise<Project> {
    const project = await this.repo.findById(id)
    if (!project) {
      throw new ProjectNotFoundError(id)
    }
    return project
  }

  async findProject(id: string): Promise<Project | null> {
    return this.repo.findById(id)
  }

  async listProjects(chatId: string, limit?: number): Promise<Project[]> {
    return this.repo.findByChatId(chatId, limit)
  }

  async deleteProject(id: string): Promise<void> {
    await this.repo.deleteById(id)
    this.logger.info(`Project deleted: ${id}`)
  }

  async updateProject(id: string, params: UpdateProjectParams): Promise<Project> {
    const project = await this.getProject(id)

    const error = validateFolderName(params.folderName)
    if (error) {
      throw new Error(error)
    }

    if (params.folderName !== project.folderName) {
      const newDir = join(this.baseWorkingDir, params.folderName)
      if (existsSync(newDir)) {
        throw new Error(`Directory already exists: ${params.folderName}`)
      }
      const oldDir = join(this.baseWorkingDir, project.folderName)
      if (existsSync(oldDir)) {
        renameSync(oldDir, newDir)
      } else {
        mkdirSync(newDir, { recursive: true })
      }
    }

    await this.repo.update(id, params)

    this.logger
      .withMetadata({ projectId: id, folderName: params.folderName })
      .info("Project updated")
    return this.getProject(id)
  }

  async touchProject(id: string): Promise<void> {
    await this.repo.touch(id)
  }

  getProjectWorkingDir(project: Project): string {
    return join(this.baseWorkingDir, project.folderName)
  }
}
