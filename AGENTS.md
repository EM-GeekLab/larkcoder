以下是详细的技术方案设计：

### 🏗️ 系统架构总览：AutoCoder Orchestrator

系统分为两个核心部分：

1. **Bot 主程序 (Controller)**：长期运行的 Docker 容器，负责业务逻辑、状态管理、飞书/GitHub 交互，以及对 Agent 容器的编排。
2. **Coding Agent (Worker)**：按需启动的临时 Docker 容器，运行 `claude-code` (或其他 ACP Server)，负责实际的代码生成和执行。

---

### 📦 模块详细设计

#### 1. 容器编排与运行时管理模块 (Container Orchestrator)

这是本方案中最底层的核心，负责管理 Coding Agent 的生命周期。

- **Docker Socket 客户端：**
- 利用 `dockerode` 或直接通过 Unix Domain Socket 调用 Docker API。
- **功能：** 负责拉取镜像、创建容器、启动容器、流式获取日志、销毁容器。

- **动态网络拓扑管理：**
- 由于 Bot 和 Agent 在不同的容器，需要确保它们网络互通。
- **方案 A (推荐)：** 创建一个专用的 Docker Bridge Network，Bot 启动时加入该网络，新启动的 Agent 容器也动态加入该网络，通过容器名（DNS）进行 SSE 通信。
- **方案 B (备选)：** Agent 容器映射随机宿主机端口，Bot 通过 `host.docker.internal` 或宿主机 IP 访问。

- **配置模版注入引擎：**
- **功能：** 解析用户预定义的“启动命令模版”。
- **变量替换：** 支持在启动命令中动态注入 `{REPO_URL}`, `{BRANCH_NAME}`, `{AUTH_VOLUME}`, `{AGENT_CONFIG}` 等变量。
- **挂载管理：** 自动处理必要的 Volume 挂载（如 Claude 的 auth token、SSH keys、工作区的持久化存储）。

#### 2. ACP 协议适配与通信层 (ACP Client & Protocol Layer)

该模块负责屏蔽底层 Agent 的差异（Claude Code vs OpenCode），实现“可插拔后端”。

- **SSE 传输适配器 (SSE Transport Adapter)：**
- 使用 @agentclientprotocol/sdk 中的 SSE 客户端实现。
- 通过 HTTP/SSE 连接到 Agent 容器的指定端口。
- 处理连接握手、心跳保活、以及断连重试机制。

- **抽象 Agent 接口 (Agent Interface Abstraction)：**
- 定义统一的操作接口：`initialize()`, `sendPrompt()`, `interrupt()`, `toolCallResult()`。
- **能力协商：** 在连接建立时，查询 Agent Server 支持的 Prompt 模版和资源类型。

- **虚拟工具桥接 (Virtual Tool Bridge)：**
- **反向代理能力：** 虽然 Agent 运行在隔离容器，但它可能需要操作 Bot 侧的资源（如“更新飞书进度”）。
- **实现：** Bot 将自身的能力（如 Lark API）封装为 MCP Tool，通过协议注册给 Agent 容器。当 Agent 调用这些工具时，请求通过 SSE 传回 Bot 执行。

#### 3. 业务流程编排器 (Workflow Orchestrator)

这是系统的“大脑”，基于有限状态机（FSM）管理任务流转。

- **状态机管理：**
- 定义状态：`Idle`, `Planning` (文档交互), `Coding` (Agent 运行中), `Reviewing` (等待 PR 反馈), `Completed`.
- 在 Redis 或持久化存储中维护每个 Task ID 对应的当前状态和上下文快照。

- **阶段处理器：**
- **Planning Handler：** 负责将飞书文档内容转换为 Agent 的初始 Context。
- **Coding Handler：** 维持“SOLO 模式”循环。自动将 Agent 的输出（思考、工具调用）记录日志，并在 Agent 请求“结束任务”时触发 PR 流程。
- **Review Handler：** 将 GitHub 的 Review Comment 转换为新的 Prompt 追加到 Agent 的对话历史中，唤醒 Agent 继续修改代码。

#### 4. 飞书深度集成模块 (Lark Integration Module)

负责与人类交互的界面层。

- **云文档双向同步引擎：**
- **Doc to Context：** 定时或触发式读取云文档内容，解析 Markdown，提取最新的 Plan 作为 Agent 的输入。
- **Comment Proxy：** 监听文档的评论事件。如果用户在文档某处评论，将其转化为带引用的 Prompt 发送给 Agent；Agent 的回复则写回文档评论区。

- **卡片消息工厂：**
- 渲染交互式卡片（状态看板、确认按钮、PR 链接跳转）。
- 处理卡片的回调事件（如点击“开始 Coding”），驱动状态机流转。

#### 5. 代码仓库交互代理 (VCS Proxy)

处理与 GitHub 的非代码类交互（代码变更由 Agent 容器内的 git 工具直接完成）。

- **Webhook 接收器：**
- 监听 GitHub Webhooks（PR Review, Issue Comment, CI Status）。
- 过滤无关事件，将关键反馈路由给 Orchestrator。

- **Git 操作辅助：**
- 虽然 Agent 自己写代码，但 Bot 可能需要负责一些元操作，如：创建 Fork、设置分支保护规则、或者在 Agent 容器销毁后清理远程分支。

---

### 🔄 详细工作流时序 (Happy Path)

1. **初始化 (Init)：**

- 用户在飞书触发指令。
- Bot 生成任务 ID，初始化状态机。

2. **规划 (Plan)：**

- Bot 调用 LLM (通过 API 或 Agent) 生成飞书文档。
- 用户在文档评论 -> Bot 监听到 webhook -> Bot 调用 Agent 回答 -> Bot 写回评论。
- 用户点击“确认 Plan”。

3. **启动环境 (Bootstrap)：**

- Orchestrator 根据用户配置的 Docker 模版，拼接命令。
- Orchestrator 调用 Docker Socket 启动 `claude-code-acp` 容器，挂载代码仓库 Volume 和 Auth Token。
- Bot 尝试通过 SSE 连接 Agent 容器。

4. **编码 (Coding - SOLO Mode)：**

- Bot 将飞书文档的最终 Plan 作为 User Prompt 发送给 Agent。
- **循环：** Agent 思考 -> 调用 ACP 工具 (读写文件/运行测试) -> 返回结果 -> Agent 继续思考。
- Bot 实时捕获这些交互日志，更新飞书卡片状态。

5. **提交 (PR)：**

- Agent 决定工作完成，执行 Git Push。
- Agent 调用（Bot 注入的）`create_pr` 工具，或 Bot 监测到 Push 后自动调用 GitHub API 创建 PR。
- Bot 销毁或挂起 Agent 容器（节省资源）。

6. **审查 (Review)：**

- 用户在 GitHub 留下评论 "Fix strict null checks"。
- Bot 收到 Webhook。
- Bot 重新唤醒/连接 Agent 容器。
- Bot 将评论内容作为新 Prompt 发送给 Agent。
- Agent 修改代码 -> Push -> Bot 通知用户。

### ⚙️ 关键配置示例 (YAML 风格)

为了满足“用户负责启动命令”的需求，Bot 的配置文件应包含如下结构：

```yaml
agent_runtime:
  # Agent 容器配置模板
  container_template:
    # 用户可以在这里自定义挂载宿主机路径到容器内
    # {{TASK_ID}} 等变量由 Bot 运行时替换
    cmd: >
      docker run -d 
      --name agent-{{TASK_ID}}
      --network bridge_autocoder
      -v /host/path/to/auth:/root/.config/claude-code
      -v /host/workspaces/{{TASK_ID}}:/app
      -e ANTHROPIC_API_KEY={{ENV_KEY}}
      localhost/dev-container-with-acp:latest
      --allow-all-tools
      --sse-port 3000

  # ACP 连接配置
  connection:
    type: "sse"
    # 这里的 host 指向容器名（Docker DNS）
    url_template: "http://agent-{{TASK_ID}}:3000/sse"
```

### 🛡️ 安全与隔离考量

1. **文件系统隔离：** Agent 容器只挂载当前任务的工作目录，无法访问宿主机其他敏感文件。
2. **网络限制：** 可以通过 Docker Network 策略限制 Agent 容器只能访问公网（下载依赖）和 Bot 容器，禁止访问内网其他服务。
3. **Token 最小权限：** 挂载给 Agent 的 GitHub Token 仅限当前仓库权限。

---

# Important Notes

下面是一些 Agent 编写代码必须遵守的准则，请你把这些准则和上面的技术方案一起，写入 AGENTS.md 并在后续的所有任务中牢记这些任务要求和准则

## Preface

This skill defines a common set of standard rules for coding agents ("agents" for short) to follow. **Bad things will happen if agents don't obey these rules.**

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this skill are to be interpreted as described in RFC 2119.

## 1. General Rules

1. Agents MUST comply with users' requirements. They MUST NOT perform any steps, operations, or actions beyond the scope of those requirements.
2. Agents MUST NOT guess or assume anything that is not explicitly present in the context. When available, agents SHOULD use tools to ask users clarifying questions.

## 2. Tool Utilization Rules

1. Agents MUST make full use of all tools provided to them.
2. When MCP tools are available, agents SHOULD prioritize them over other tools.

- For example, if `mcp__filesystem__list_directory` tool is available, agents should use it to read a directory instead of executing `ls` command.

3. `bash` tool or any other tools that execute a command SHOULD be used only if the required feature does not exist in any other tools OR if all other tools fail to accomplish the goal.

- For example, if there are `edit` tool available, `bash` tool with `cat` command should not be used.

## 3. Code Editing Rules

1. Agents SHOULD NOT edit any files or directories related to coding standards, including but not limited to linter configuration files, formatter configuration files, and any other files that are used to configure the coding environment. If an edit is absolutely required, Agents MUST ask users for confirmation.
2. Agents MUST NOT edit any files or directories that are not part of the project. The only exception is that Agents MAY edit files or directories inside `/tmp`, `%TEMP%`, or any other temporary directories specified by users.

## 4. Code Analysis Rules

1. Agents SHOULD frequently check LSP (Language Server Protocol) messages (if available), linting outputs and type checking results. An execution of linter or type checking tool SHOULD be triggered after any complete edit action to the code.
2. Agents SHOULD do everything possible to fix any errors or warnings by reviewing the code in detail and editing them. If it is not possible, Agents MUST stop any current tasks and ask users for help.
3. Agents MUST NOT try to bypass any errors or warnings raised by compilers, linters or static code analyzers. Forbidden methods include but not limited to:

- Disabling or suppressing compiler warnings or linter rules by inserting disabling comments or editing configuration files.
- Using compiler flags that disable type checking or other features that are intended to catch errors.
- Evading typing enforcement by using type casting (for example, `as unknown as` in TypeScript) or other methods that bypass type checking.
- Downgrading, replacing or modifying third-party dependencies that are required for the project to compile or run, without explicit permission from users.
- Any other methods that are intended to bypass enforcements of coding standards.

## 5. Documentation Fetching Rules

1. Agents SHOULD fetch the latest documentation of tools, libraries, and frameworks used in the project by calling any tool possible to do so. For example, `bash` with `man` command for Unix commands, or `context7` MCP tool or `fetch` tool if they are provided.

- Exception: Common knowledge or well-known tools are allowed to be used without fetching documentation.

2. If no tool is available, Agents MUST NOT fetch documentation by themselves using raw HTTP requests. For example, agents must not use `curl` command to fetch websites.
3. Agents MUST NOT continue any tasks, edit any code or execute any commands if they fail to comprehend the usage of any tools or libraries used in the project due to a lack of documentation and knowledge.

## 6. Unit Testing Rules

1. Agents SHOULD write unit tests for all code that is not trivial or obvious.

- Exception: Agents MAY choose not to write unit tests if there are no unit test frameworks available or if the project does not require unit testing.

2. Unit tests SHOULD be written in a way that is easy to read and understand.
3. Unit tests SHOULD cover all possible scenarios and edge cases.
4. Agents MUST NOT write unit tests that cheat on the coverage of the code. Examples include but not limited to:

- Writing tests that only execute code without asserting behavior
- Adding meaningless tests that pass trivially (assert True)
- Testing trivial code while avoiding complex logic
- Creating tests for code that's never used in production

## Closing Words

Coding agents exist to help developers to write code faster and more efficiently. They are not meant to replace developers, but to assist them in their tasks. Therefore, standards must be followed to ensure that the code is of high quality and maintainable.
