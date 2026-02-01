import { readFile } from "node:fs/promises"
import { parse as parseYaml } from "yaml"
import { appConfigSchema, type AppConfig } from "./types.js"

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const rawText = await readFile(filePath, "utf8")
  const raw = parseYaml(rawText)
  return appConfigSchema.parse(raw)
}
