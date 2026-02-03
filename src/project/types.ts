export type Project = {
  id: string
  chatId: string
  creatorId: string
  title: string
  description?: string
  folderName: string
  createdAt: string
  updatedAt: string
}

export type CreateProjectParams = {
  chatId: string
  creatorId: string
  title: string
  description?: string
  folderName: string
}

export type UpdateProjectParams = {
  title: string
  description?: string
  folderName: string
}
