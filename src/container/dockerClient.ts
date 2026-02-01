import Docker from "dockerode"

export type DockerClientOptions = {
  socketPath?: string
  host?: string
  port?: number
  protocol?: "http" | "https"
}

export function createDockerClient(options: DockerClientOptions = {}): Docker {
  const socketPath = options.socketPath ?? process.env.DOCKER_SOCKET
  if (socketPath) {
    return new Docker({ socketPath })
  }

  if (options.host || options.port || options.protocol) {
    return new Docker({
      host: options.host,
      port: options.port,
      protocol: options.protocol,
    })
  }

  return new Docker()
}
