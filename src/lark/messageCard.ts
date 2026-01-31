import type { WorkflowState } from "../workflow/types.js";

export type WorkflowCardInput = {
  taskId: string;
  state: WorkflowState;
  summary?: string;
  prUrl?: string;
  telemetry?: WorkflowTelemetry;
};

export type WorkflowTelemetry = {
  summary: string;
};

export function buildWorkflowCard(
  input: WorkflowCardInput,
): Record<string, unknown> {
  const lines = [`**Task:** ${input.taskId}`, `**State:** ${input.state}`];
  if (input.summary) {
    lines.push("", `**Plan:**\n${input.summary}`);
  }
  if (input.telemetry?.summary) {
    lines.push("", `**Activity:** ${input.telemetry.summary}`);
  }
  if (input.prUrl) {
    lines.push("", `**PR:** ${input.prUrl}`);
  }

  const elements: Array<Record<string, unknown>> = [
    {
      tag: "markdown",
      content: lines.join("\n"),
    },
  ];

  if (input.state === "Planning") {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: {
            tag: "plain_text",
            content: "Start Coding",
          },
          value: {
            action: "start_coding",
            task_id: input.taskId,
          },
        },
      ],
    });
  }

  if (input.prUrl) {
    elements.push({
      tag: "action",
      actions: [
        {
          tag: "button",
          type: "primary",
          text: {
            tag: "plain_text",
            content: "Open PR",
          },
          url: input.prUrl,
        },
      ],
    });
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: `AutoCoder · ${input.state}`,
      },
    },
    elements,
  };
}
