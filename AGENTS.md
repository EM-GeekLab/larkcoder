# LarkCoder

Control Claude Code (ACP Server) via Lark/Feishu IM messages to complete coding tasks on remote servers.

## Agent Coding Guidelines

The keywords "MUST", "SHOULD", "MAY" in these guidelines are interpreted according to RFC 2119.

### General

- MUST strictly follow user requirements without exceeding scope.
- MUST NOT guess or assume information not present in context; confirm with user when uncertain.

### Tool Usage

- MUST make full use of all available tools.
- SHOULD prioritize MCP tools when available (e.g., `mcp__filesystem__list_directory` over `ls`).
- Command execution tools like `bash` should only be used when other tools cannot complete the task.

### Code Editing

- SHOULD only write comments at critical points, explaining why rather than what
- SHOULD NOT write extensive comments
- SHOULD NOT edit linter/formatter config files; user confirmation required if modification is necessary.
- MUST NOT edit files outside the project (except temporary directories like `/tmp`).

### Code Checking

- Runtime MUST use `bun run` to execute scripts defined in `package.json`:
  - `bun run check` — Type checking (tsc --noEmit)
  - `bun run lint` — Lint checking (oxlint)
  - `bun run lint:fix` — Auto-fix linting issues
  - `bun run fmt` — Format code (oxfmt)
  - `bun run fmt:check` — Check formatting
  - `CLAUDECODE=1 bun run test` — Run unit tests (when applicable)

### Code Analysis

- SHOULD frequently check LSP, linter, and type checker results; trigger checks after each edit.
- SHOULD make every effort to fix all errors/warnings; MUST stop and ask user for help if unable to fix.
- MUST NOT bypass errors through:
  - Inserting disable comments or modifying linter config
  - Using type assertions like `as unknown as` to bypass type checking
  - Arbitrarily downgrading/replacing/modifying third-party dependencies

### Documentation Retrieval

- SHOULD retrieve latest documentation through tools (`man`, context7 MCP, fetch tools, etc.); common knowledge excepted.
- MUST NOT use raw HTTP requests like `curl` to scrape web pages.
- MUST NOT continue coding when unable to understand the usage of tools/libraries.

## Project-Specific Guidelines

### Runtime Environment

- This project uses **Bun** as the runtime environment, not Node.js.
- Prefer Bun-specific APIs when available (e.g., `Bun.stripANSI()` for ANSI code removal).
- Use `bun` command instead of `npm` or `node` for all operations.

### Database

- This project uses **Drizzle ORM** with **Bun SQLite** for database operations.
- Schema changes workflow:
  1. Modify schema files in `src/db/schema/`
  2. Run `bun run db:generate` to generate migration files
  3. Restart program (migrations are automatically applied on startup)
- MUST NOT directly modify database files or bypass the ORM layer.

### Configuration

- New configuration options MUST be added to both:
  - Schema definition in `src/config/schema.ts`
  - Example file in `config.example.yaml`
- Configuration fields SHOULD have sensible defaults.
- Configuration documentation MUST be updated in both README files (English and Chinese).
