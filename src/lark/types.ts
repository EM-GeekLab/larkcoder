export type LarkConfig = {
  appId: string
  appSecret: string
  docToken?: string
  docType?: "docx" | "wiki"
}

export type ParsedMessage = {
  messageId: string
  chatId: string
  chatType: "p2p" | "group"
  senderId: string
  rootId?: string
  text: string
}

export type CardAction = {
  openId: string
  openMessageId: string
  openChatId: string
  action: string
  sessionId?: string
  optionId?: string
  modelId?: string
}
