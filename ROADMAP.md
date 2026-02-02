# Roadmap

## Plan Mode Q&A (AskUserQuestion)

**Status:** Blocked — waiting for upstream support

Claude Code plan mode 有一个问答功能（`AskUserQuestion`），允许 Agent 向用户提问并等待回答。当前 ACP 无法支持此功能。

### 现状

- `@zed-industries/claude-code-acp` 显式禁用了 `AskUserQuestion` 工具（`acp-agent.js:505-506`），注释标注为 in progress work。
- ACP 协议没有原生的 "请求用户输入" 机制；`session/request_permission` 仅用于工具授权。
- 当前 Agent 提问只能以文本形式出现在流式卡片中，用户通过发送消息回复。

### 实施计划

待 claude-code-acp 支持 `AskUserQuestion` 后（预计通过 `extMethod` 自定义扩展方法），在 LarkCoder 中实现：

1. **`ClientBridge.extMethod()`**（`src/agent/clientBridge.ts`）— 添加新分支处理 ask user 请求，路由到 orchestrator callback。
2. **`Orchestrator`**（`src/orchestrator/orchestrator.ts`）— 新增 `handleInputRequest` 方法，复用现有 permission request 模式：暂停流式卡片 → 发送问答交互卡片到飞书 → 等待用户选择 → 返回结果。
3. **`cardTemplates.ts`**（`src/lark/cardTemplates.ts`）— 新增问答卡片模板（展示问题文本 + 选项按钮）。
