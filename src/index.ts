import type { TaskData } from "./workflow/types.js";
import { serve } from "@hono/node-server";

import { ACPClient } from "./acp/acpClient.js";
import { ClientBridge } from "./acp/clientBridge.js";
import { loadConfig } from "./config/loadConfig.js";
import { renderTemplate, type TemplateVariables } from "./config/template.js";
import { createDockerClient } from "./container/dockerClient.js";
import {
  ContainerOrchestrator,
  type ContainerOrchestratorOptions,
} from "./container/orchestrator.js";
import { createServer } from "./http/server.js";
import { LarkClient } from "./lark/larkClient.js";
import { createLogger } from "./utils/logger.js";
import { GithubClient } from "./vcs/githubClient.js";
import {
  type AgentClientFactory,
  type AgentClientFactoryOptions,
  WorkflowOrchestrator,
} from "./workflow/orchestrator.js";
import { InMemoryStateStore, RedisStateStore } from "./workflow/store.js";
async function main() {
  const logger = createLogger();
  const configPath = process.env.CONFIG_PATH ?? "config.yaml";
  const config = await loadConfig(configPath);

  const docker = createDockerClient();
  const orchestratorOptions: ContainerOrchestratorOptions = { logger };

  if (config.network?.name) {
    orchestratorOptions.networkName = config.network.name;
  }

  const containerOrchestrator = new ContainerOrchestrator(
    docker,
    config.agentRuntime.containerTemplate,
    orchestratorOptions,
  );

  const stateStore = config.redis
    ? new RedisStateStore({ url: config.redis.url })
    : new InMemoryStateStore();

  const larkClient = config.lark
    ? new LarkClient(config.lark, fetch, logger)
    : undefined;

  const githubClient = config.github?.token && config.github?.repository
    ? new GithubClient(
        {
          token: config.github.token,
          apiBaseUrl: config.github.apiBaseUrl,
          repository: config.github.repository,
        },
        fetch,
        logger,
      )
    : undefined;

  const acpClientFactory: AgentClientFactory = (
    options: AgentClientFactoryOptions,
  ) => createAcpClient(config.agentRuntime.connection, logger, options);

  const workflow = new WorkflowOrchestrator(stateStore, {
    containerOrchestrator,
    acpClientFactory,
    larkClient,
    githubClient:
      githubClient
        ? {
            createPullRequest: (request) => githubClient.createPullRequest(request),
            defaultBaseBranch: config.github?.defaultBaseBranch,
          }
        : undefined,
    mcpServerBaseUrl: config.server.publicBaseUrl,
    logger,
  });

  const app = createServer(config, logger, workflow, larkClient);
  const server = serve({ fetch: app.fetch, port: config.server.port });
  server.on("listening", () => {
    logger.withMetadata({ port: config.server.port }).info("Server listening");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function createAcpClient(
  connection: {
    urlTemplate: string;
    sendUrlTemplate?: string;
    headers?: Record<string, string>;
  },
  logger: ReturnType<typeof createLogger>,
  options: AgentClientFactoryOptions,
): ACPClient {
  const variables = buildTemplateVariables(options.taskId, options.data);
  const streamUrl = renderTemplate(connection.urlTemplate, variables);
  const sendUrl = connection.sendUrlTemplate
    ? renderTemplate(connection.sendUrlTemplate, variables)
    : undefined;
  const headers = connection.headers
    ? Object.fromEntries(
        Object.entries(connection.headers).map(([key, value]) => [
          key,
          renderTemplate(value, variables),
        ]),
      )
    : undefined;

  const bridge = new ClientBridge({
    logger,
    onSessionUpdate: options.onSessionUpdate,
    toolDefinitions: options.toolDefinitions,
    tools: options.toolHandlers,
  });

  return new ACPClient(
    {
      streamUrl,
      sendUrl,
      headers,
      clientCapabilities: {},
    },
    bridge,
  );
}

function buildTemplateVariables(
  taskId: string,
  data?: TaskData,
): TemplateVariables {
  const env = Object.entries(process.env).reduce<TemplateVariables>(
    (acc, [key, value]) => {
      acc[key] = value;
      return acc;
    },
    {},
  );

  return {
    ...env,
    ...data?.variables,
    TASK_ID: taskId,
    REPO_URL: data?.repoUrl,
    BRANCH_NAME: data?.branchName,
    AUTH_VOLUME: data?.authVolume,
    AGENT_CONFIG: data?.agentConfig,
    AGENT_HOST: data?.agentHost,
    AGENT_PORT: data?.agentPort ? String(data.agentPort) : undefined,
  };
}
