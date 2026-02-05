import { defineConfig } from "drizzle-kit"
import { loadConfig } from "./src/config/loader"
import { getConfigPath } from "./src/config/path"

const configPath = getConfigPath()
const databasePath = loadConfig(configPath).database.path

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/session/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${databasePath}`,
  },
})
