# AutoCoder Orchestrator

AutoCoder Orchestrator coordinates agent containers, ACP sessions, and workflow state across Lark and GitHub. The runtime is Node.js `http` with a Hono router and oRPC for RPC endpoints.

## Architecture

- **Runtime**: Node.js `http` server.
- **Router**: Hono for HTTP/webhook endpoints.
- **RPC**: oRPC (`/rpc/*`) for internal RPC calls.
- **Containers**: Docker via dockerode (pull/create/start/logs/destroy).
- **State**: In-memory by default, Redis when configured.
- **Integrations**: Lark webhooks + GitHub webhooks.

## Requirements

- Node.js 18+.
- pnpm (recommended).
- Docker daemon accessible to the process.
- Optional: Redis for persistent state.
- Lark and GitHub credentials if you enable those integrations.

## Setup

1. Install dependencies

```bash
pnpm install
```

2. Create `config.yaml`

```yaml
agent_runtime:
  container_template:
    cmd: >
      docker run -d \
      --name agent-{{TASK_ID}} \
      --network bridge_autocoder \
      -v /host/path/to/auth:/root/.config/claude-code \
      -v /host/workspaces/{{TASK_ID}}:/app \
      -e ANTHROPIC_API_KEY={{ENV_KEY}} \
      localhost/dev-container-with-acp:latest \
      --allow-all-tools \
      --sse-port 3000

  connection:
    type: "sse"
    url_template: "http://agent-{{TASK_ID}}:3000/sse"
    send_url_template: "http://agent-{{TASK_ID}}:3000/sse"
    headers:
      authorization: "Bearer {{ACP_TOKEN}}"

server:
  port: 8080
  public_base_url: "http://localhost:8080"

network:
  name: bridge_autocoder

redis:
  url: "redis://localhost:6379"

lark:
  app_id: "cli_xxx"
  app_secret: "secret"
  base_url: "https://open.larksuite.com"
  token_url: "/open-apis/auth/v3/tenant_access_token/internal"
  comment_url_template: "/open-apis/drive/v1/files/{DOC_TOKEN}/comments"
  comment_file_type: "docx"
  message_card_url_template: "/open-apis/im/v1/messages"
  message_card_receive_id: "oc_123"
  message_card_receive_id_type: "open_id"
  doc_content_url_template: "/open-apis/docx/v1/documents/{DOC_TOKEN}/raw_content"
  doc_create_url_template: "/open-apis/docx/v1/documents"
  doc_token_type: "auto" # docx, wiki, auto
  wiki_node_url_template: "/open-apis/wiki/v2/spaces/get_node"

github:
  webhook_secret: "your-webhook-secret"
  token: "github-token"
  repository: "org/repo"
  default_base_branch: "main"
  api_base_url: "https://api.github.com"
```

3. Start the server

```bash
pnpm dev
```

`CONFIG_PATH` defaults to `config.yaml`. Override with:

```bash
CONFIG_PATH=/path/to/config.yaml pnpm dev
```

## Template variables

The container template and ACP connection templates support:

- `TASK_ID`
- `REPO_URL`
- `BRANCH_NAME`
- `AUTH_VOLUME`
- `AGENT_CONFIG`
- `AGENT_HOST`
- `AGENT_PORT`
- Any environment variables exported to the process

## HTTP Endpoints

- `GET /healthz` - health check.
- `POST /webhooks/github` - GitHub webhook handler.
- `POST /webhooks/lark` - Lark webhook handler.
- `POST /rpc/*` - oRPC endpoints (internal).

All RPC traffic under `/rpc` is handled by oRPC. All other HTTP endpoints are handled by Hono.

## Webhook Setup

### GitHub

Configure a webhook pointing to `/webhooks/github` and enable:

- `pull_request_review`
- `pull_request_review_comment`
- `issue_comment`
- `check_run`
- `check_suite`
- `status`

Set the webhook secret to match `github.webhook_secret`.

### Lark

Configure Lark webhooks to call `/webhooks/lark`. The handler supports:

- Doc update events (used for doc-to-context)
- Comment events (comment proxy to agent)
- Card actions (e.g., Start Coding button)

The handler responds to the verification challenge automatically.

## Workflow Usage

1. Lark doc update triggers Planning and stores plan context.
2. Card action `start_coding` triggers Coding and starts an ACP session.
3. The SOLO loop streams logs from ACP session updates.
4. Agent `create_pr` tool requests transition to Reviewing and posts PR info.
5. GitHub review comments re-trigger Coding with review feedback.

## Commands

```bash
pnpm run check   # typecheck
pnpm run lint    # lint
pnpm run test    # unit tests
```

## Troubleshooting

- **Docker permission errors**: ensure the process can access the Docker socket.
- **Network errors**: make sure the configured `network.name` exists or is creatable.
- **ACP connection errors**: verify `agent_runtime.connection.url_template` resolves to the agent container.
- **Lark API errors**: confirm `base_url`, `token_url`, and app credentials.
- **Lark wiki tokens**: set `lark.doc_token_type` to `wiki` or `auto` and configure `lark.wiki_node_url_template`.
- **GitHub signature mismatch**: verify the webhook secret and raw payload handling.
