import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { ProcessManager } from "./agent/processManager.js"
import { loadConfig } from "./config/loader.js"
import { LarkClient } from "./lark/client.js"
import { DocService } from "./lark/docService.js"
import { LarkEventHandler } from "./lark/eventHandler.js"
import { Orchestrator } from "./orchestrator/orchestrator.js"
import { createDatabase } from "./session/db.js"
import { SessionRepository } from "./session/repository.js"
import { SessionService } from "./session/service.js"
import { createLogger } from "./utils/logger.js"

async function main(): Promise<void> {
  const logger = createLogger({ prefix: "larkcoder" })
  logger.info("Starting LarkCoder...")

  // Load config
  const configPath = process.env.CONFIG_PATH ?? "config.yaml"
  const config = await loadConfig(configPath)
  logger.info(`Config loaded from ${configPath}`)

  // Ensure database directory exists
  mkdirSync(dirname(config.database.path), { recursive: true })

  // Initialize data layer
  const { db, close: closeDb } = await createDatabase(config.database.path)
  const sessionRepo = new SessionRepository(db, config.database.eventMaxAge * 1000)
  const sessionService = new SessionService(sessionRepo, createLogger({ prefix: "session" }))

  // Initialize process manager
  const processManager = new ProcessManager({
    command: config.agent.command,
    args: config.agent.args,
    logger: createLogger({ prefix: "process" }),
  })

  // Initialize Lark
  const larkClient = new LarkClient(config.lark, createLogger({ prefix: "lark" }))
  const docService = new DocService(larkClient, createLogger({ prefix: "doc" }))

  // Initialize orchestrator
  const orchestrator = new Orchestrator(
    config,
    sessionService,
    processManager,
    larkClient,
    docService,
    createLogger({ prefix: "orchestrator" }),
  )

  // Initialize event handler and create EventDispatcher
  const eventHandler = new LarkEventHandler(createLogger({ prefix: "event" }))
  eventHandler.onMessage(async (message) => {
    await orchestrator.handleMessage(message)
  })
  eventHandler.onCardAction(async (action) => {
    await orchestrator.handleCardAction(action)
  })

  const eventDispatcher = eventHandler.createEventDispatcher(sessionService)

  // Start Lark WebSocket long connection
  await larkClient.startWS(eventDispatcher)
  logger.info("Lark WebSocket client connected")

  // Graceful shutdown
  const shutdown = (): void => {
    logger.info("Shutting down...")
    larkClient.closeWS()
    orchestrator.shutdown()
    closeDb()
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

main().catch((error: unknown) => {
  const logger = createLogger({ prefix: "larkcoder" })
  logger.withError(error as Error).error("Fatal error")
  process.exit(1)
})
