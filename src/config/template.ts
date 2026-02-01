export type TemplateVariables = Record<string, string | number | undefined>

const BRACE_PATTERN = /{{\s*([A-Z0-9_]+)\s*}}/g
const SINGLE_BRACE_PATTERN = /{\s*([A-Z0-9_]+)\s*}/g

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
): string {
  const replace = (match: string, key: string) => {
    const value = variables[key]
    if (value === undefined) {
      throw new Error(`Missing template variable: ${key}`)
    }
    return String(value)
  }

  const withDouble = template.replace(BRACE_PATTERN, replace)
  return withDouble.replace(SINGLE_BRACE_PATTERN, replace)
}
