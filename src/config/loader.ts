import { YAML } from "bun"
import { readFileSync } from "node:fs"
import { extractErrorMessage } from "../utils/errors"
import { appConfigSchema, type AppConfig } from "./schema"

export function loadConfig(filePath: string): AppConfig {
  try {
    const rawText = readFileSync(filePath, "utf8")
    const raw = YAML.parse(rawText)
    return appConfigSchema.parse(raw)
  } catch (error) {
    throw new Error(`Failed to load configuration: ${extractErrorMessage(error)}`)
  }
}
