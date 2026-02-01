import { os } from "@orpc/server"
import { z } from "zod"
import type { LarkClient } from "../lark/larkClient.js"
import type { WorkflowOrchestrator } from "../workflow/orchestrator.js"

const taskDataSchema = z.object({
  docToken: z.string().min(1).optional(),
  docTokenType: z.enum(["docx", "wiki", "auto"]).optional(),
  planMarkdown: z.string().min(1).optional(),
  planContext: z.string().min(1).optional(),
  repoUrl: z.string().min(1).optional(),
  branchName: z.string().min(1).optional(),
  authVolume: z.string().min(1).optional(),
  agentConfig: z.string().min(1).optional(),
  variables: z.record(z.string(), z.string()).optional(),
  workingDir: z.string().min(1).optional(),
  messageCardReceiveId: z.string().min(1).optional(),
  messageCardReceiveIdType: z.string().min(1).optional(),
  githubRepository: z.string().min(1).optional(),
  githubBaseBranch: z.string().min(1).optional(),
  githubHeadBranch: z.string().min(1).optional(),
  agentHost: z.string().min(1).optional(),
  agentPort: z.number().int().positive().optional(),
})

type RpcContext = {
  headers?: Record<string, string>
  workflow: WorkflowOrchestrator
  lark?: LarkClient
}

const builder = os.$context<RpcContext>()

export const health = builder.handler(async () => ({ status: "ok" }))

export const createTask = builder
  .input(
    z.object({
      taskId: z.string().min(1),
      data: taskDataSchema.optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    return await context.workflow.createTask(input.taskId, input.data)
  })

export const startCoding = builder
  .input(z.object({ taskId: z.string().min(1) }))
  .handler(async ({ context, input }) => {
    return await context.workflow.startCoding(input.taskId)
  })

export const initPlanning = builder
  .input(
    z.object({
      taskId: z.string().min(1),
      markdown: z.string().min(1).optional(),
      docToken: z.string().min(1).optional(),
      docTitle: z.string().min(1).optional(),
      docFolderToken: z.string().min(1).optional(),
      createDoc: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, input }) => {
    let docToken = input.docToken
    if (!docToken && input.createDoc) {
      if (!context.lark) {
        throw new Error("Lark is not configured for doc creation")
      }
      const created = await context.lark.createDocxDocument({
        title: input.docTitle ?? "AutoCoder Plan",
        folderToken: input.docFolderToken,
      })
      docToken = created?.documentId
    }

    if (!docToken && !input.markdown) {
      throw new Error("docToken or markdown is required to init planning")
    }

    if (input.markdown) {
      return await context.workflow.handleDocContext(
        input.taskId,
        input.markdown,
        docToken,
      )
    }

    return { ok: true, docToken }
  })

export const router = {
  system: {
    health,
  },
  workflow: {
    createTask,
    startCoding,
    initPlanning,
  },
}

export type AppRouter = typeof router
