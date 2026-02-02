# LarkCoder

通过飞书 IM 消息控制 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)，在远程服务器上完成编码工作。

## 功能

- **飞书对话驱动** — 在飞书聊天中直接向 Claude Code 发送编码指令，支持私聊和群组
- **流式输出** — 通过飞书交互式卡片实时展示 Agent 的输出内容和工具调用过程
- **多会话管理** — 每个对话/话题独立维护会话，支持创建、恢复、切换和删除
- **权限确认** — Agent 执行敏感操作时弹出确认卡片，由用户选择是否允许
- **模型切换** — 在飞书中随时切换 Claude 模型
- **文档集成** — 可将飞书文档内容作为上下文注入 Agent

## 前置条件

- [Bun](https://bun.sh) 运行时
- [Claude Code ACP Server](https://www.npmjs.com/package/@anthropic-ai/claude-code-acp)（`claude-code-acp` 命令可用）
- 飞书开放平台应用（需开启消息接收和卡片回调事件）

## 快速开始

```bash
# 克隆项目
git clone <repo-url> && cd larkcoder

# 安装依赖
bun install

# 从模板创建配置文件并填写飞书凭据
cp config.example.yaml config.yaml

# 初始化数据库
bun run db:push

# 启动服务
bun run dev
```

也可以直接运行启动脚本，它会自动完成依赖安装和数据库迁移：

```bash
./start.sh
```

## 配置

编辑 `config.yaml`（参考 `config.example.yaml`）：

```yaml
lark:
  app_id: "cli_xxxxxx" # 飞书应用 App ID
  app_secret: "your_app_secret" # 飞书应用 App Secret

agent:
  working_dir: "/path/to/work" # Agent 工作目录
```

## 使用

直接在飞书中发送消息即可与 Agent 对话。在群组中需要 @机器人。

发送 `/help` 查看所有可用命令。

## License

MIT
