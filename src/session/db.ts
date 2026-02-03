import { Database } from "bun:sqlite"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "./schema"

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>

export function createDatabase(dbPath: string): {
  db: DrizzleDB
  close: () => void
} {
  const client = new Database(dbPath)
  const db = drizzle({ client, schema })

  db.run(sql`PRAGMA journal_mode = WAL`)
  db.run(sql`PRAGMA foreign_keys = ON`)
  migrate(db, { migrationsFolder: "./drizzle" })

  return { db, close: () => client.close() }
}
