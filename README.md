# LarkCoder

**English** | [中文](README.zh.md)

Control [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code) and other ACP-compatible Coding Agents via Lark/Feishu IM messages to complete coding tasks on remote servers.

## Features

- **Lark/Feishu Conversation Driven** — Send coding instructions directly to ACP-compatible Coding Agents in Lark/Feishu chat, supporting both private chats and groups
- **Shell Command Execution** — Execute shell commands in session working directory using `!` prefix with real-time streaming output
- **Streaming Output** — Display Agent output and tool calls in real-time via Lark/Feishu interactive cards
- **Multi-Session Management** — Each conversation/thread maintains independent sessions, supporting create, resume, switch, and delete operations
- **Project Management** — Create, switch, and edit projects, each with independent working directory and session space
- **Permission Confirmation** — Interactive confirmation cards when Agent performs sensitive operations
- **Model Switching** — Switch Claude models anytime in Lark/Feishu

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code ACP Server](https://www.npmjs.com/package/@zed-industries/claude-code-acp) (install first: `npm install -g @zed-industries/claude-code-acp`, ensure `claude-code-acp` command is available; other compatible ACP servers can be used by modifying the config)
- Lark/Feishu Open Platform app (with message receiving and card callback events enabled)

## Quick Start

### Option 1: Using bunx (Recommended)

Run directly via `bunx` without cloning the project:

```bash
# Initialize config file
bunx --bun larkcoder --init

# Edit config file and fill in Lark/Feishu app credentials
# Edit config.yaml

# Start service
bunx --bun larkcoder
```

### Option 2: Local Development

```bash
# Clone project
git clone <repo-url> && cd larkcoder

# Install dependencies
bun install

# Initialize config file (using CLI)
bun run start -- --init
# Or run directly
bun bin/larkcoder.ts --init

# Edit config file and fill in Lark/Feishu app credentials
# Edit config.yaml

# Start service (using CLI, recommended for local debugging)
bun run start
# Or run directly
bun bin/larkcoder.ts

# Or use dev mode (run src/index.ts directly, uses CONFIG_PATH env var)
bun run dev
```

You can also run the startup script directly, which will automatically install dependencies and run database migrations:

```bash
./start.sh
```

**Local Debugging Tips**:

- Use `bun run start` or `bun bin/larkcoder.ts` to use CLI features (like `--init`, `--config`, etc.) just like `bunx --bun larkcoder`, but runs local code for easy debugging and modification
- Use `bun run dev` to run `src/index.ts` directly for quick startup (uses default `config.yaml` or `CONFIG_PATH` env var)

## Configuration

### CLI Options

```bash
bunx --bun larkcoder [options]

Options:
  -c, --config <path>  Specify config file path (default: config.yaml)
  -i, --init           Initialize config file from template
  -h, --help           Show help message
```

### Config File

After initializing with `--init`, edit `config.yaml`:

```yaml
lark:
  app_id: "cli_xxxxxx" # Lark/Feishu App ID
  app_secret: "your_app_secret" # Lark/Feishu App Secret
  stream_flush_interval: 150 # ms, streaming output throttle interval

agent:
  command: "claude-code-acp" # ACP command (can be replaced with other compatible ACP)
  args: [] # Command arguments
  working_dir: "/path/to/work" # Agent working directory

database:
  path: ".larkcoder/data/larkcoder.db" # Database file path
  event_max_age: 86400 # seconds, max event retention time (default 1 day)

shell:
  timeout: 300000 # ms, shell command timeout (default 5 minutes)
  max_output: 100000 # bytes, max output size (default 100KB)
```

> **Tip**: You can use other ACP-compatible Coding Agents by modifying the `agent.command` and `agent.args` fields.
>
> **Shell Config**: The `shell` config section is optional, defaults will be used if not configured.

## Usage

Send messages directly in Lark/Feishu to interact with the Agent. In groups, you need to @mention the bot.

### Command List

Send `/help` to see all available commands. Common commands:

- `/new [prompt]` — Create new session
- `/stop` — Stop Agent
- `/kill` — Kill running shell command
- `/model` — Switch model
- `/project` — Project management

### Shell Command Execution

Use `!` prefix to execute shell commands in session's working directory:

```bash
! ls -la
! git status
! npm install
```

- Real-time streaming output with automatic ANSI color code cleanup
- Support for pipes, redirects, and full shell features
- Timeout protection (default 5 minutes) and output limit (default 100KB)
- Footer displays execution time and exit code (e.g., `5s · Exit: 0`)
- Use `/kill` to terminate running command

## License

MIT
