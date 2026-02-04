import { readFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"
import { appConfigSchema, type AppConfig } from "./schema"

export function loadConfig(filePath: string): AppConfig {
  const rawText = readFileSync(filePath, "utf8")
  const raw: unknown = parseYaml(rawText)
  const result = appConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(`Failed to load configuration: ${result.error.message}`)
  }
  return result.data
}
