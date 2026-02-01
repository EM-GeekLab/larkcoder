# LarkCoder

通过飞书 IM 消息控制 Claude Code (ACP Server)，在远程服务器上完成编码工作。

## Agent 编码准则

以下准则中，"MUST"、"SHOULD"、"MAY" 等关键词按 RFC 2119 解释。

### 通用

- MUST 严格按用户需求执行，不得超出范围。
- MUST NOT 猜测或假设上下文中不存在的信息；不确定时应向用户确认。

### 工具使用

- MUST 充分利用所有可用工具。
- MCP 工具可用时 SHOULD 优先使用（如 `mcp__filesystem__list_directory` 优于 `ls`）。
- `bash` 等命令执行工具仅在其他工具无法完成时使用。

### 代码编辑

- SHOULD NOT 编辑 linter/formatter 等编码标准配置文件，必须修改时须用户确认。
- MUST NOT 编辑项目外文件（`/tmp` 等临时目录除外）。

### 代码检查

- 运行时 MUST 使用 `bun run` 执行 `package.json` 中定义的 scripts：
  - `bun run check` — 类型检查（tsc --noEmit）
  - `bun run lint` — Lint 检查（oxlint）
  - `bun run lint:fix` — Lint 自动修复
  - `bun run fmt` — 格式化（oxfmt）
  - `bun run fmt:check` — 格式化检查
  - `CLAUDECODE=1 bun run test` — 单元测试

### 代码分析

- SHOULD 频繁检查 LSP、linter、类型检查结果；每次编辑后应触发检查。
- SHOULD 尽力修复所有 error/warning；无法修复时 MUST 停止并求助用户。
- MUST NOT 通过以下方式绕过错误：
  - 插入禁用注释或修改 linter 配置
  - 使用 `as unknown as` 等类型强转绕过类型检查
  - 擅自降级/替换/修改第三方依赖

### 文档获取

- SHOULD 通过工具获取最新文档（`man`、context7 MCP、fetch 工具等）；常识性内容除外。
- MUST NOT 使用 `curl` 等原始 HTTP 请求自行抓取网页。
- 无法理解所用工具/库的用法时 MUST NOT 继续编码。

### 单元测试

- SHOULD 为非 trivial 代码编写单元测试（无测试框架时除外）。
- 测试须可读、覆盖边界情况。
- MUST NOT 写欺骗覆盖率的测试（无断言、trivially pass、只测无用代码等）。
