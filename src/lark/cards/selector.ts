type SelectorItem = {
  label: string
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
  models: Array<{ modelId: string; label: string }>
}

export function buildModelSelectCard(data: ModelSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.models.map((m) => ({
      label: m.label,
      isCurrent: data.currentModel ? m.modelId === data.currentModel : undefined,
      callbackValue: { action: "model_select", session_id: data.sessionId, model_id: m.modelId },
    })),
  )
}

type ModeSelectCardData = {
  sessionId: string
  currentMode: string
  modes: Array<{ modeId: string; label: string }>
}

export function buildModeSelectCard(data: ModeSelectCardData): Record<string, unknown> {
  return buildSelectorCard(
    data.modes.map((m) => ({
      label: m.label,
      isCurrent: m.modeId === data.currentMode,
      callbackValue: { action: "mode_select", session_id: data.sessionId, mode_id: m.modeId },
    })),
  )
}
