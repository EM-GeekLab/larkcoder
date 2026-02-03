import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { migrate } from "drizzle-orm/libsql/migrator"
import * as schema from "./schema"

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>

export async function createDatabase(dbPath: string): Promise<{
  db: DrizzleDB
  close: () => void
}> {
  const client = createClient({ url: `file:${dbPath}` })
  await client.execute("PRAGMA journal_mode = WAL")
  await client.execute("PRAGMA foreign_keys = ON")

  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "./drizzle" })

  return { db, close: () => client.close() }
}
