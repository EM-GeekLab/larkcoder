import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/session/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${process.env.DATABASE_URL ?? "data/larkcoder.db"}`,
  },
})
