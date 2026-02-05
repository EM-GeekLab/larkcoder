const DEFAULT_CONFIG_PATH = ".larkcoder/config.yaml"

export function getConfigPath(): string {
  return process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH
}
