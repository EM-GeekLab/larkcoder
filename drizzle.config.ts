import { defineConfig } from "drizzle-kit"
import { loadConfig } from "./src/config/loader"

const configPath = process.env.CONFIG_PATH ?? "config.yaml"
const databasePath = loadConfig(configPath).database.path

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/session/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${databasePath}`,
  },
})
