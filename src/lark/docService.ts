import type { Logger } from "../utils/logger.js"
import type { LarkClient } from "./client.js"

export class DocService {
  constructor(
    private larkClient: LarkClient,
    private logger: Logger,
  ) {}

  async readDocContent(docToken: string): Promise<string | null> {
    this.logger.info(`Reading doc: ${docToken}`)
    return this.larkClient.fetchDocContent(docToken)
  }

  async buildDocContext(docToken?: string): Promise<string | null> {
    if (!docToken) {
      return null
    }
    const content = await this.readDocContent(docToken)
    if (!content) {
      return null
    }
    return `\n--- Document Context ---\n${content}\n--- End Document Context ---\n`
  }
}
