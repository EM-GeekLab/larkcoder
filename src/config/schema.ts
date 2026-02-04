import { z } from "zod"

const rawConfigSchema = z.object({
  lark: z.object({
    app_id: z.string().min(1),
    app_secret: z.string().min(1),
    doc_token: z.string().min(1).optional(),
    stream_flush_interval: z.number().int().positive().default(150),
  }),

  agent: z.object({
    command: z.string().min(1).default("claude-code-acp"),
    args: z.array(z.string()).default([]),
    working_dir: z.string().min(1),
    system_prompt: z.string().optional(),
  }),

  database: z.object({
    path: z.string().min(1),
    event_max_age: z.number().int().positive().default(86400),
  }),

  shell: z
    .object({
      timeout: z.number().int().positive().default(300000), // 5 minutes
      max_output: z.number().int().positive().default(100000), // 100KB
    })
    .optional(),
})

export type RawConfig = z.input<typeof rawConfigSchema>

export const appConfigSchema = rawConfigSchema.transform((raw) => ({
  lark: {
    appId: raw.lark.app_id,
    appSecret: raw.lark.app_secret,
    docToken: raw.lark.doc_token,
    streamFlushInterval: raw.lark.stream_flush_interval,
  },
  agent: {
    command: raw.agent.command,
    args: raw.agent.args,
    workingDir: raw.agent.working_dir,
    systemPrompt: raw.agent.system_prompt,
  },
  database: {
    path: raw.database.path,
    eventMaxAge: raw.database.event_max_age,
  },
  shell: raw.shell
    ? {
        timeout: raw.shell.timeout,
        maxOutput: raw.shell.max_output,
      }
    : undefined,
}))

export type AppConfig = z.output<typeof appConfigSchema>
