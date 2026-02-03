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

export type ListItem = {
  label: string
  description?: string
  isCurrent?: boolean
  icon: { token: string; color?: string }
  time: string
  callbackValue: Record<string, unknown>
}

export type ListCardOptions = {
  title?: string
  borderColor?: string
}

export function buildListCard(
  items: ListItem[],
  options?: ListCardOptions,
): Record<string, unknown> {
  const borderColor = options?.borderColor ?? "grey"

  const interactiveContainers = items.map((item) => ({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    horizontal_align: "left",
    background_style: "default",
    has_border: true,
    border_color: borderColor,
    corner_radius: "8px",
    padding: "4px 12px 4px 12px",
    vertical_spacing: item.description ? "0px" : undefined,
    behaviors: [{ type: "callback", value: item.callbackValue }],
    elements: [
      {
        tag: "column_set",
        flex_mode: "flow",
        background_style: "default",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 1,
            vertical_align: "center",
            elements: [
              {
                tag: "markdown",
                content: item.label,
                icon: { tag: "standard_icon", ...item.icon },
              },
            ],
          },
          ...(item.isCurrent
            ? [
                {
                  tag: "column",
                  width: "auto",
                  weight: 1,
                  vertical_align: "center",
                  elements: [
                    {
                      tag: "markdown",
                      content: "<font color='grey'>current</font>",
                      text_size: "notation",
                    },
                  ],
                },
              ]
            : []),
          {
            tag: "column",
            width: "auto",
            weight: 1,
            vertical_align: "center",
            elements: [
              {
                tag: "markdown",
                content: `<font color='grey'>${item.time}</font>`,
                text_size: "notation",
              },
            ],
          },
        ],
      },
      ...(item.description
        ? [
            {
              tag: "markdown",
              content: `<font color='grey'>${item.description}</font>`,
              text_size: "notation",
              margin: "0px 0px 0px 24px",
            },
          ]
        : []),
    ],
  }))

  const card: Record<string, unknown> = {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "default",
          columns: [
            {
              tag: "column",
              width: "weighted",
              weight: 1,
              vertical_align: "top",
              vertical_spacing: "8px",
              elements: interactiveContainers,
            },
          ],
        },
      ],
    },
  }

  if (options?.title) {
    card.header = {
      title: { tag: "plain_text", content: options.title },
      template: "indigo",
    }
  }

  return card
}
