import { format } from "date-fns"
import type { Project } from "../../project/types"
import { truncate } from "./common"

export function buildProjectInfoCard(project: Project): Record<string, unknown> {
  const time = format(new Date(project.createdAt), "yyyy-MM-dd HH:mm:ss")
  const description = project.description || "无"
  const content = [
    `**描述**: ${description}`,
    `**目录**: \`${project.folderName}/\``,
    `**创建时间**: ${time}`,
  ].join("\n")

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: "plain_text", content: project.title },
      template: "indigo",
    },
    body: {
      elements: [{ tag: "markdown", content }],
    },
  }
}

export function buildProjectEditCard(project: Project): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: "plain_text", content: "编辑项目" },
      template: "indigo",
    },
    body: {
      elements: [
        {
          tag: "form",
          name: "project_edit_form",
          elements: [
            {
              tag: "input",
              name: "project_title",
              required: true,
              default_value: project.title,
              label: { tag: "plain_text", content: "项目标题" },
              placeholder: { tag: "plain_text", content: "请输入项目标题" },
              width: "fill",
            },
            {
              tag: "input",
              name: "project_description",
              required: false,
              default_value: project.description ?? "",
              label: { tag: "plain_text", content: "项目描述" },
              placeholder: { tag: "plain_text", content: "请输入项目描述（可选）" },
              input_type: "multiline_text",
              max_length: 500,
              auto_resize: true,
              width: "fill",
            },
            {
              tag: "input",
              name: "project_folder",
              required: true,
              default_value: project.folderName,
              label: { tag: "plain_text", content: "仓库目录名" },
              placeholder: { tag: "plain_text", content: "请输入目录名" },
              width: "fill",
            },
            {
              tag: "column_set",
              flex_mode: "none",
              horizontal_spacing: "8px",
              horizontal_align: "right",
              margin: "16px 0px 0px 0px",
              columns: [
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: { tag: "plain_text", content: "保存" },
                      type: "primary",
                      form_action_type: "submit",
                      name: "btn_project_edit_submit",
                      behaviors: [
                        {
                          type: "callback",
                          value: {
                            action: "project_edit",
                            project_id: project.id,
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: { tag: "plain_text", content: "取消" },
                      type: "default",
                      name: "btn_project_edit_cancel",
                      behaviors: [
                        {
                          type: "callback",
                          value: { action: "project_cancel" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

export function buildProjectCreateCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: {
        tag: "plain_text",
        content: "创建项目",
      },
      template: "indigo",
    },
    body: {
      elements: [
        {
          tag: "form",
          name: "project_form",
          elements: [
            {
              tag: "input",
              name: "project_title",
              required: true,
              label: {
                tag: "plain_text",
                content: "项目标题",
              },
              placeholder: {
                tag: "plain_text",
                content: "请输入项目标题",
              },
              width: "fill",
            },
            {
              tag: "input",
              name: "project_description",
              required: false,
              label: {
                tag: "plain_text",
                content: "项目描述",
              },
              placeholder: {
                tag: "plain_text",
                content: "请输入项目描述（可选）",
              },
              input_type: "multiline_text",
              max_length: 500,
              auto_resize: true,
              width: "fill",
            },
            {
              tag: "input",
              name: "project_folder",
              required: false,
              label: {
                tag: "plain_text",
                content: "仓库目录名",
              },
              placeholder: {
                tag: "plain_text",
                content: "留空则由 AI 自动生成",
              },
              width: "fill",
            },
            {
              tag: "column_set",
              flex_mode: "none",
              horizontal_spacing: "8px",
              horizontal_align: "right",
              margin: "16px 0px 0px 0px",
              columns: [
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: {
                        tag: "plain_text",
                        content: "创建",
                      },
                      type: "primary",
                      form_action_type: "submit",
                      name: "btn_project_submit",
                      behaviors: [
                        {
                          type: "callback",
                          value: {
                            action: "project_create",
                          },
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: "column",
                  width: "auto",
                  elements: [
                    {
                      tag: "button",
                      text: {
                        tag: "plain_text",
                        content: "取消",
                      },
                      type: "default",
                      name: "btn_project_cancel",
                      behaviors: [
                        {
                          type: "callback",
                          value: { action: "project_cancel" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  }
}

export function buildProjectListCard(
  projects: Project[],
  currentProjectId?: string,
): Record<string, unknown> {
  const interactiveContainers = projects.map((p) => {
    const title = truncate(p.title, 40)
    const description = p.description ? truncate(p.description, 60) : undefined
    const isCurrent = currentProjectId !== undefined && p.id === currentProjectId
    const time = format(new Date(p.updatedAt), "yyyy-MM-dd HH:mm:ss")
    return {
      tag: "interactive_container",
      width: "fill",
      height: "auto",
      horizontal_align: "left",
      background_style: "default",
      has_border: true,
      border_color: "grey",
      corner_radius: "8px",
      padding: "4px 12px 4px 12px",
      vertical_spacing: description ? "0px" : undefined,
      behaviors: [
        {
          type: "callback",
          value: {
            action: "project_select",
            project_id: p.id,
          },
        },
      ],
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
                  content: title,
                  icon: {
                    tag: "standard_icon",
                    token: "folder_outlined",
                  },
                },
              ],
            },
            ...(isCurrent
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
                  content: `<font color='grey'>${time}</font>`,
                  text_size: "notation",
                },
              ],
            },
          ],
        },
        ...(description
          ? [
              {
                tag: "markdown",
                content: `<font color='grey'>${description}</font>`,
                text_size: "notation",
                margin: "0px 0px 0px 24px",
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
