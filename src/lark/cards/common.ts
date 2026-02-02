export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

export function buildMarkdownCard(content: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [{ tag: "markdown", content }],
    },
  }
}

export function buildSelectedCard(text: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [{ tag: "markdown", content: text }],
    },
  }
}
