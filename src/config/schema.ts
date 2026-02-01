import { z } from "zod"

const rawConfigSchema = z.object({
  lark: z.object({
    app_id: z.string().min(1),
    app_secret: z.string().min(1),
    doc_token: z.string().min(1).optional(),
    doc_type: z.enum(["docx", "wiki"]).optional(),
  }),

  agent: z.object({
    command: z.string().min(1).default("claude-code-acp"),
    args: z.array(z.string()).default([]),
    working_dir: z.string().min(1),
    max_turns: z.number().int().positive().optional(),
    system_prompt: z.string().optional(),
  }),

  database: z
    .object({
      path: z.string().min(1).default("data/larkcoder.db"),
    })
    .optional(),
})

export type RawConfig = z.input<typeof rawConfigSchema>

export const appConfigSchema = rawConfigSchema.transform((raw) => ({
  lark: {
    appId: raw.lark.app_id,
    appSecret: raw.lark.app_secret,
    docToken: raw.lark.doc_token,
    docType: raw.lark.doc_type,
  },
  agent: {
    command: raw.agent.command,
    args: raw.agent.args,
    workingDir: raw.agent.working_dir,
    maxTurns: raw.agent.max_turns,
    systemPrompt: raw.agent.system_prompt,
  },
  database: {
    path: raw.database?.path ?? "data/larkcoder.db",
  },
}))

export type AppConfig = z.output<typeof appConfigSchema>
