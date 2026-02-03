import { readFileSync } from "node:fs"
import { join } from "node:path"

export function getExampleConfig(): string {
  const configPath = join(import.meta.dir, "..", "config.example.yaml")
  return readFileSync(configPath, "utf8")
}
