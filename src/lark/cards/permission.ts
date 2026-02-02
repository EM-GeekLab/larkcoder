type PermissionCardData = {
  sessionId: string
  toolDescription: string
  options: Array<{ optionId: string; label: string }>
}

export function buildPermissionCard(data: PermissionCardData): Record<string, unknown> {
  const interactiveContainers = data.options.map((opt) => ({
    tag: "interactive_container",
    width: "fill",
    height: "auto",
    horizontal_align: "left",
    background_style: "default",
    has_border: true,
    border_color: "grey",
    corner_radius: "8px",
    padding: "4px 12px 4px 12px",
    behaviors: [
      {
        type: "callback",
        value: {
          action: "permission_select",
          session_id: data.sessionId,
          option_id: opt.optionId,
        },
      },
    ],
    elements: [
      {
        tag: "markdown",
        content: opt.label,
      },
    ],
  }))

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: data.toolDescription,
        },
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

type PermissionSelectedCardData = {
  toolDescription: string
  selectedLabel: string
}

export function buildPermissionSelectedCard(
  data: PermissionSelectedCardData,
): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: data.toolDescription,
        },
        {
          tag: "markdown",
          content: `**已选择：** ${data.selectedLabel}`,
        },
      ],
    },
  }
}
