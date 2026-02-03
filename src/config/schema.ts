import { z } from "zod"

const rawConfigSchema = z.object({
  lark: z.object({
    app_id: z.string().min(1),
    app_secret: z.string().min(1),
    doc_token: z.string().min(1).optional(),
    doc_type: z.enum(["docx", "wiki"]).optional(),
    stream_flush_interval: z.number().int().positive().default(150),
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
      event_max_age: z.number().int().positive().default(86400),
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
    streamFlushInterval: raw.lark.stream_flush_interval,
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
    eventMaxAge: raw.database?.event_max_age ?? 86400,
  },
}))

export type AppConfig = z.output<typeof appConfigSchema>
