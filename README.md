# LarkCoder

通过飞书 IM 消息控制 [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code) 等 ACP 兼容的 Coding Agent，在远程服务器上完成编码工作。

## 功能

- **飞书对话驱动** — 在飞书聊天中直接向 ACP 兼容的 Coding Agent 发送编码指令，支持私聊和群组
- **流式输出** — 通过飞书交互式卡片实时展示 Agent 的输出内容和工具调用过程
- **多会话管理** — 每个对话/话题独立维护会话，支持创建、恢复、切换和删除
- **项目管理** — 支持创建、切换、编辑项目，每个项目拥有独立的工作目录和会话空间
- **权限确认** — Agent 执行敏感操作时弹出确认卡片，由用户选择是否允许
- **模型切换** — 在飞书中随时切换 Claude 模型

## 前置条件

- [Bun](https://bun.sh) 运行时
- [Claude Code ACP Server](https://www.npmjs.com/package/@zed-industries/claude-code-acp)（需先安装：`npm install -g @zed-industries/claude-code-acp`，确保 `claude-code-acp` 命令可用；也可使用其他兼容的 ACP，通过修改配置文件即可）
- 飞书开放平台应用（需开启消息接收和卡片回调事件）

## 快速开始

### 方式一：使用 bunx（推荐）

直接通过 `bunx` 运行，无需克隆项目：

```bash
# 初始化配置文件
bunx --bun larkcoder --init

# 编辑配置文件，填写飞书应用凭据
# 编辑 config.yaml

# 启动服务
bunx --bun larkcoder
```

### 方式二：本地开发

```bash
# 克隆项目
git clone <repo-url> && cd larkcoder

# 安装依赖
bun install

# 从模板创建配置文件并填写飞书凭据
cp config.example.yaml config.yaml

# 启动服务
bun run dev
```

也可以直接运行启动脚本，它会自动完成依赖安装和数据库迁移：

```bash
./start.sh
```

## 配置

### CLI 选项

```bash
bunx --bun larkcoder [选项]

选项:
  -c, --config <path>  指定配置文件路径 (默认: config.yaml)
  -i, --init           初始化配置文件（从模板创建）
  -h, --help           显示帮助信息
```

### 配置文件

编辑 `config.yaml`（参考 `config.example.yaml`）：

```yaml
lark:
  app_id: "cli_xxxxxx" # 飞书应用 App ID
  app_secret: "your_app_secret" # 飞书应用 App Secret

agent:
  working_dir: "/path/to/work" # Agent 工作目录
```

> **提示**：可以使用兼容的 ACP，通过修改配置文件中的 `agent.command` 和 `agent.args` 字段即可。

## 使用

直接在飞书中发送消息即可与 Agent 对话。在群组中需要 @机器人。

发送 `/help` 查看所有可用命令。

## License

MIT
