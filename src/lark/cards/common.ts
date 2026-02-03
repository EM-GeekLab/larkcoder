export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text
  }
  return `${text.slice(0, maxLen)}...`
}

type IconOption = { token: string; color?: string }

export function buildMarkdownCard(content: string, icon?: IconOption): Record<string, unknown> {
  const element: Record<string, unknown> = { tag: "markdown", content }
  if (icon) {
    element.icon = { tag: "standard_icon", ...icon }
  }
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [element],
    },
  }
}

export function escapeLarkMd(text: string): string {
  return text.replace(/</g, "＜").replace(/>/g, "＞").replace(/\*/g, "﹡").replace(/~/g, "∼")
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
