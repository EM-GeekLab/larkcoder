type SelectorItem = {
  label: string
  description?: string
  isCurrent?: boolean
  callbackValue: Record<string, unknown>
}

function buildSelectorCard(items: SelectorItem[]): Record<string, unknown> {
  const hasCurrentItem = items.some((item) => item.isCurrent)

  const interactiveContainers = items.map((item) => {
    const isCurrent = item.isCurrent ?? false
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: isCurrent ? "grey-100" : "default",
      has_border: true,
      border_color: isCurrent ? undefined : "grey",
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      vertical_spacing: item.description ? "0px" : undefined,
      behaviors: [
        {
          type: "callback",
          value: item.callbackValue,
        },
      ],
      elements: [
        {
          tag: "markdown",
          content: item.label,
          icon:
            hasCurrentItem && isCurrent
              ? { tag: "standard_icon", token: "done_outlined", color: "grey" }
              : undefined,
          margin: hasCurrentItem && !isCurrent ? "0px 0px 0px 23px" : undefined,
        },
        ...(item.description
          ? [
              {
                tag: "markdown",
                content: `<font color='grey'>${item.description}</font>`,
                text_size: "notation",
                margin: hasCurrentItem ? "0px 0px 0px 23px" : undefined,
              },
            ]
          : []),
      ],
    }
  })

  return {
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
}

type ModelSelectCardData = {
  sessionId: string
  currentModel?: string
  models: Array<{ modelId: string; label: string; description?: string }>
}

export function buildModelSelectCard(data: ModelSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.models.map((m) => ({
      label: m.label,
      description: m.description,
      isCurrent: data.currentModel ? m.modelId === data.currentModel : undefined,
      callbackValue: { action: "model_select", session_id: data.sessionId, model_id: m.modelId },
    })),
  )
}

type CommandSelectCardData = {
  sessionId: string
  commands: Array<{ name: string; description?: string }>
}

export function buildCommandSelectCard(data: CommandSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.commands.map((c) => ({
      label: `/${c.name}`,
      description: c.description,
      callbackValue: { action: "command_select", session_id: data.sessionId, command_name: c.name },
    })),
  )
}

type ModeSelectCardData = {
  sessionId: string
  currentMode: string
  modes: Array<{ modeId: string; label: string; description?: string }>
}

export function buildModeSelectCard(data: ModeSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.modes.map((m) => ({
      label: m.label,
      description: m.description,
      isCurrent: m.modeId === data.currentMode,
      callbackValue: { action: "mode_select", session_id: data.sessionId, mode_id: m.modeId },
    })),
  )
}

type ConfigOption = {
  id: string
  name: string
  description?: string | null
  currentValue: string
  options:
    | Array<{ value: string; name: string; description?: string | null }>
    | Array<{
        group: string
        name: string
        options: Array<{ value: string; name: string; description?: string | null }>
      }>
}

type ConfigSelectCardData = {
  sessionId: string
  configOptions: ConfigOption[]
}

function resolveCurrentValueName(option: ConfigOption): string {
  for (const item of option.options) {
    if ("group" in item) {
      const found = item.options.find((o) => o.value === option.currentValue)
      if (found) {
        return found.name
      }
    } else if (item.value === option.currentValue) {
      return item.name
    }
  }
  return option.currentValue
}

export function buildConfigSelectCard(data: ConfigSelectCardData): Record<string, unknown> {
  const containers = data.configOptions.map((c) => ({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    horizontal_align: "left",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "4px 12px 4px 12px",
    vertical_spacing: c.description ? "0px" : undefined,
    behaviors: [
      {
        type: "callback",
        value: { action: "config_detail", session_id: data.sessionId, config_id: c.id },
      },
    ],
    elements: [
      {
        tag: "column_set",
        flex_mode: "bisect",
        columns: [
          {
            tag: "column",
            width: "weighted",
            weight: 1,
            vertical_align: "center",
            elements: [{ tag: "markdown", content: c.name }],
          },
          {
            tag: "column",
            width: "auto",
            vertical_align: "center",
            elements: [
              {
                tag: "markdown",
                content: `<font color='grey'>${resolveCurrentValueName(c)}</font>`,
              },
            ],
          },
        ],
      },
      ...(c.description
        ? [
            {
              tag: "markdown",
              content: `<font color='grey'>${c.description}</font>`,
              text_size: "notation",
            },
          ]
        : []),
    ],
  }))

  return {
    schema: "2.0",
    config: { wide_screen_mode: true, update_multi: true },
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
              elements: containers,
            },
          ],
        },
      ],
    },
  }
}

type ConfigValueSelectCardData = {
  sessionId: string
  configId: string
  configName: string
  currentValue: string
  options: ConfigOption["options"]
}

export function buildConfigValueSelectCard(
  data: ConfigValueSelectCardData,
): Record<string, unknown> {
  const items: SelectorItem[] = []

  for (const item of data.options) {
    if ("group" in item) {
      for (const opt of item.options) {
        items.push({
          label: `${item.name} / ${opt.name}`,
          description: opt.description ?? undefined,
          isCurrent: opt.value === data.currentValue,
          callbackValue: {
            action: "config_select",
            session_id: data.sessionId,
            config_id: data.configId,
            config_value: opt.value,
          },
        })
      }
    } else {
      items.push({
        label: item.name,
        description: item.description ?? undefined,
        isCurrent: item.value === data.currentValue,
        callbackValue: {
          action: "config_select",
          session_id: data.sessionId,
          config_id: data.configId,
          config_value: item.value,
        },
      })
    }
  }

  return buildSelectorCard(items)
}
