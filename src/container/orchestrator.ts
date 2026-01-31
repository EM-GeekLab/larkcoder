import type Docker from "dockerode";
import { PassThrough } from "node:stream";
import { renderTemplate, type TemplateVariables } from "../config/template.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { splitCommand } from "./commandTemplate.js";

export type ContainerTemplate = {
  cmd: string;
};

export type LaunchOptions = {
  taskId: string;
  repoUrl?: string;
  branchName?: string;
  authVolume?: string;
  agentConfig?: string;
  variables?: Record<string, string>;
};

export type AgentContainer = {
  id: string;
  name: string;
  network?: string;
  command: string;
  image: string;
  workingDir?: string;
  host?: string;
  hostPort?: number;
};

export type ContainerOrchestratorOptions = {
  networkName?: string;
  logger?: Logger;
};

type DockerRunSpec = {
  image: string;
  name?: string;
  network?: string;
  env: string[];
  binds: string[];
  cmd: string[];
  workdir?: string;
  entrypoint?: string;
  labels: Record<string, string>;
  user?: string;
  autoRemove: boolean;
  exposedPorts: Record<string, Record<string, never>>;
  portBindings: Record<string, Array<{ HostPort: string; HostIp?: string }>>;
  publishedPorts: Array<{ hostPort?: string; containerPort: string }>;
};

export type LogStreamHandle = {
  stream: NodeJS.ReadableStream;
  stop: () => void;
};

export type ContainerOrchestratorClient = {
  launchAgent: (options: LaunchOptions) => Promise<AgentContainer>;
  stopAgent: (containerName: string) => Promise<void>;
  streamAgentLogs: (containerName: string) => Promise<LogStreamHandle>;
};

export class ContainerOrchestrator {
  private logger: Logger;

  constructor(
    private docker: Docker,
    private template: ContainerTemplate,
    private options: ContainerOrchestratorOptions = {},
  ) {
    this.logger = options.logger ?? createLogger({ prefix: "ContainerOrchestrator" });
  }

  async ensureNetwork(name: string): Promise<void> {
    const networks = await this.docker.listNetworks({
      filters: { name: [name] },
    });

    if (networks.length > 0) {
      return;
    }

    await this.docker.createNetwork({ Name: name, Driver: "bridge" });
    this.logger.withMetadata({ name }).info("Created docker network");
  }

  async launchAgent(options: LaunchOptions): Promise<AgentContainer> {
    const variables = this.buildTemplateVariables(options);
    const rendered = renderTemplate(this.template.cmd, variables);
    const spec = parseDockerRunCommand(rendered, this.logger);

    const containerName = spec.name;
    if (!containerName) {
      throw new Error("Container name missing from command template");
    }

    const networkName = spec.network ?? this.options.networkName;

    if (networkName) {
      await this.ensureNetwork(networkName);
    }

    await this.pullImage(spec.image);

    const createOptions: Docker.ContainerCreateOptions = {
      name: containerName,
      Image: spec.image,
      Cmd: spec.cmd.length > 0 ? spec.cmd : undefined,
      Env: spec.env.length > 0 ? spec.env : undefined,
      WorkingDir: spec.workdir,
      Entrypoint: spec.entrypoint,
      Labels: Object.keys(spec.labels).length > 0 ? spec.labels : undefined,
      User: spec.user,
      ExposedPorts:
        Object.keys(spec.exposedPorts).length > 0
          ? spec.exposedPorts
          : undefined,
      HostConfig: {
        Binds: spec.binds.length > 0 ? spec.binds : undefined,
        AutoRemove: spec.autoRemove || undefined,
        PortBindings:
          Object.keys(spec.portBindings).length > 0
            ? spec.portBindings
            : undefined,
        NetworkMode: networkName,
      },
    };

    this.logger
      .withMetadata({
        name: containerName,
        network: networkName,
        image: spec.image,
      })
      .info("Launching agent container");

    const container = await this.docker.createContainer(createOptions);
    await container.start();

    if (networkName) {
      await this.connectContainerToNetwork(container.id, networkName);
    }

    const portInfo = await this.resolveHostPort(container, spec);
    if (portInfo) {
      this.logger
        .withMetadata({ name: containerName, host: portInfo.host, port: portInfo.port })
        .info("Resolved agent host port mapping");
    }

    return {
      id: container.id,
      name: containerName,
      network: networkName,
      command: rendered,
      image: spec.image,
      workingDir: spec.workdir,
      host: portInfo?.host,
      hostPort: portInfo?.port,
    };
  }

  async stopAgent(containerName: string): Promise<void> {
    const container = this.docker.getContainer(containerName);
    try {
      await container.stop({ t: 10 });
    } catch (error) {
      this.logger
        .withMetadata({ name: containerName })
        .withError(error)
        .warn("Failed to stop container");
    }

    try {
      await container.remove({ force: true });
    } catch (error) {
      this.logger
        .withMetadata({ name: containerName })
        .withError(error)
        .warn("Failed to remove container");
    }
  }

  async streamAgentLogs(containerName: string): Promise<LogStreamHandle> {
    const container = this.docker.getContainer(containerName);
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      timestamps: true,
    });

    const combined = new PassThrough();
    container.modem.demuxStream(logStream, combined, combined);

    return {
      stream: combined,
      stop: () => {
        if ("destroy" in logStream && typeof logStream.destroy === "function") {
          logStream.destroy();
        }
        combined.end();
      },
    };
  }

  private buildTemplateVariables(options: LaunchOptions): TemplateVariables {
    const environment = Object.entries(process.env).reduce<TemplateVariables>(
      (acc, [key, value]) => {
        acc[key] = value;
        return acc;
      },
      {},
    );

    return {
      ...environment,
      ...options.variables,
      TASK_ID: options.taskId,
      REPO_URL: options.repoUrl,
      BRANCH_NAME: options.branchName,
      AUTH_VOLUME: options.authVolume,
      AGENT_CONFIG: options.agentConfig,
    };
  }

  private async pullImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (error) {
      this.logger.withMetadata({ image }).info("Docker image missing, pulling");
      void error;
    }

    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  private async connectContainerToNetwork(
    containerId: string,
    networkName: string,
  ): Promise<void> {
    const container = this.docker.getContainer(containerId);
    const details = await container.inspect();
    const networks = details.NetworkSettings?.Networks ?? {};

    if (networks[networkName]) {
      return;
    }

    const network = this.docker.getNetwork(networkName);
    await network.connect({ Container: containerId });
  }

  private async resolveHostPort(
    container: Docker.Container,
    spec: DockerRunSpec,
  ): Promise<{ host: string; port: number } | null> {
    if (spec.publishedPorts.length === 0) {
      return null;
    }

    const inspected = await container.inspect();
    const bindings = inspected.NetworkSettings?.Ports ?? {};
    for (const published of spec.publishedPorts) {
      const hostBindings = bindings[published.containerPort];
      if (!hostBindings || hostBindings.length === 0) {
        continue;
      }
      const hostBinding = hostBindings[0];
      const hostPort = Number.parseInt(hostBinding?.HostPort ?? "", 10);
      if (Number.isNaN(hostPort)) {
        continue;
      }
      const host = normalizeHost(hostBinding?.HostIp);
      return { host, port: hostPort };
    }

    return null;
  }
}

function normalizeHost(hostIp?: string): string {
  if (!hostIp || hostIp === "0.0.0.0") {
    return "127.0.0.1";
  }
  return hostIp;
}

function parseDockerRunCommand(command: string, logger: Logger): DockerRunSpec {
  const tokens = splitCommand(command);
  if (tokens.length < 2 || tokens[0] !== "docker" || tokens[1] !== "run") {
    throw new Error("Command template must start with 'docker run'");
  }

  const args = tokens.slice(2);
  const spec: DockerRunSpec = {
    image: "",
    env: [],
    binds: [],
    cmd: [],
    labels: {},
    autoRemove: false,
    exposedPorts: {},
    portBindings: {},
    publishedPorts: [],
  };

  let index = 0;
  let parsingOptions = true;
  while (index < args.length) {
    const arg = args[index];
    if (!arg) {
      index += 1;
      continue;
    }

    if (parsingOptions && arg === "--") {
      parsingOptions = false;
      index += 1;
      continue;
    }

    if (parsingOptions && arg.startsWith("-")) {
      const next = args[index + 1];
      if (arg === "--name" || arg.startsWith("--name=")) {
        const { value, advance } = readOptionValue(arg, next, "--name");
        spec.name = value;
        index += advance;
        continue;
      }

      if (arg === "--network" || arg.startsWith("--network=")) {
        const { value, advance } = readOptionValue(arg, next, "--network");
        spec.network = value;
        index += advance;
        continue;
      }

      if (
        arg === "-e" ||
        arg === "--env" ||
        arg.startsWith("-e") ||
        arg.startsWith("--env=")
      ) {
        const { value, advance } = readOptionValue(arg, next, "--env");
        spec.env.push(resolveEnvValue(value));
        index += advance;
        continue;
      }

      if (
        arg === "-v" ||
        arg === "--volume" ||
        arg.startsWith("-v") ||
        arg.startsWith("--volume=")
      ) {
        const { value, advance } = readOptionValue(arg, next, "--volume");
        spec.binds.push(value);
        index += advance;
        continue;
      }

      if (
        arg === "-w" ||
        arg === "--workdir" ||
        arg.startsWith("--workdir=") ||
        arg.startsWith("-w")
      ) {
        const { value, advance } = readOptionValue(arg, next, "--workdir");
        spec.workdir = value;
        index += advance;
        continue;
      }

      if (arg === "--entrypoint" || arg.startsWith("--entrypoint=")) {
        const { value, advance } = readOptionValue(arg, next, "--entrypoint");
        spec.entrypoint = value;
        index += advance;
        continue;
      }

      if (arg === "--user" || arg.startsWith("--user=")) {
        const { value, advance } = readOptionValue(arg, next, "--user");
        spec.user = value;
        index += advance;
        continue;
      }

      if (
        arg === "-p" ||
        arg === "--publish" ||
        arg.startsWith("-p") ||
        arg.startsWith("--publish=")
      ) {
        const { value, advance } = readOptionValue(arg, next, "--publish");
        applyPortBinding(value, spec);
        index += advance;
        continue;
      }

      if (
        arg === "--label" ||
        arg.startsWith("--label=") ||
        arg === "-l" ||
        arg.startsWith("-l")
      ) {
        const { value, advance } = readOptionValue(arg, next, "--label");
        const [key, labelValue] = splitOnce(value, "=");
        if (!key) {
          throw new Error("Label must include a key");
        }
        spec.labels[key] = labelValue ?? "";
        index += advance;
        continue;
      }

      if (arg === "--rm") {
        spec.autoRemove = true;
        index += 1;
        continue;
      }

      if (arg === "-d" || arg === "--detach") {
        index += 1;
        continue;
      }

      const advance = arg.includes("=")
        ? 1
        : next && !next.startsWith("-")
          ? 2
          : 1;
      logger
        .withMetadata({ arg })
        .warn("Unsupported docker run option, ignoring");
      index += advance;
      continue;
    }

    if (!spec.image) {
      spec.image = arg;
    } else {
      spec.cmd.push(arg);
    }
    index += 1;
  }

  if (!spec.image) {
    throw new Error("Docker image missing from command template");
  }

  return spec;
}

function readOptionValue(
  arg: string,
  next: string | undefined,
  flag: string,
): { value: string; advance: number } {
  const assignmentIndex = arg.indexOf("=");
  if (assignmentIndex > -1) {
    return { value: arg.slice(assignmentIndex + 1), advance: 1 };
  }

  if (arg.startsWith("-e") && arg.length > 2 && flag === "--env") {
    return { value: arg.slice(2), advance: 1 };
  }

  if (arg.startsWith("-v") && arg.length > 2 && flag === "--volume") {
    return { value: arg.slice(2), advance: 1 };
  }

  if (arg.startsWith("-p") && arg.length > 2 && flag === "--publish") {
    return { value: arg.slice(2), advance: 1 };
  }

  if (arg.startsWith("-l") && arg.length > 2 && flag === "--label") {
    return { value: arg.slice(2), advance: 1 };
  }

  if (!next) {
    throw new Error(`Missing value for ${flag}`);
  }

  return { value: next, advance: 2 };
}

function resolveEnvValue(value: string): string {
  if (value.includes("=")) {
    return value;
  }

  const envValue = process.env[value];
  if (envValue === undefined) {
    return `${value}=`;
  }

  return `${value}=${envValue}`;
}

function applyPortBinding(binding: string, spec: DockerRunSpec): void {
  const parts = binding.split(":");
  if (parts.length === 1 && parts[0]) {
    applyContainerOnlyPort(parts[0], spec);
    return;
  }
  if (parts.length < 2) {
    throw new Error(`Invalid port binding: ${binding}`);
  }

  const containerPart = parts[parts.length - 1];
  const hostPart = parts[parts.length - 2];
  if (!containerPart || !hostPart) {
    throw new Error(`Invalid port binding: ${binding}`);
  }
  const hostIp = parts.length > 2 ? parts.slice(0, -2).join(":") : undefined;
  const containerPort = containerPart.includes("/")
    ? containerPart
    : `${containerPart}/tcp`;

  spec.exposedPorts[containerPort] = {};
  const bindingEntry = { HostPort: hostPart } as {
    HostPort: string;
    HostIp?: string;
  };
  if (hostIp) {
    bindingEntry.HostIp = hostIp;
  }

  if (!spec.portBindings[containerPort]) {
    spec.portBindings[containerPort] = [];
  }
  spec.portBindings[containerPort].push(bindingEntry);
  spec.publishedPorts.push({
    hostPort: hostPart,
    containerPort,
  });
}

function applyContainerOnlyPort(containerPort: string, spec: DockerRunSpec): void {
  const normalized = containerPort.includes("/")
    ? containerPort
    : `${containerPort}/tcp`;
  spec.exposedPorts[normalized] = {};
  if (!spec.portBindings[normalized]) {
    spec.portBindings[normalized] = [];
  }
  spec.portBindings[normalized].push({ HostPort: "" });
  spec.publishedPorts.push({ containerPort: normalized });
}

function splitOnce(
  value: string,
  delimiter: string,
): [string, string | undefined] {
  const index = value.indexOf(delimiter);
  if (index === -1) {
    return [value, undefined];
  }
  return [value.slice(0, index), value.slice(index + delimiter.length)];
}
