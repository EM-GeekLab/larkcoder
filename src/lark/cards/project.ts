import { format } from "date-fns"
import type { Project } from "../../project/types"
import { buildListCard, truncate, type ListItem } from "./common"

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

type ProjectFormConfig = {
  headerTitle: string
  submitLabel: string
  callbackAction: string
  projectId?: string
  defaults?: { title?: string; description?: string; folderName?: string }
  folderRequired?: boolean
  folderPlaceholder?: string
}

function buildProjectFormCard(config: ProjectFormConfig): Record<string, unknown> {
  const callbackValue: Record<string, unknown> = { action: config.callbackAction }
  if (config.projectId) {
    callbackValue.project_id = config.projectId
  }

  return {
    schema: "2.0",
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: "plain_text", content: config.headerTitle },
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
              default_value: config.defaults?.title,
              label: { tag: "plain_text", content: "项目标题" },
              placeholder: { tag: "plain_text", content: "请输入项目标题" },
              width: "fill",
            },
            {
              tag: "input",
              name: "project_description",
              required: false,
              default_value: config.defaults?.description ?? "",
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
              required: config.folderRequired ?? false,
              default_value: config.defaults?.folderName,
              label: { tag: "plain_text", content: "仓库目录名" },
              placeholder: {
                tag: "plain_text",
                content: config.folderPlaceholder ?? "请输入目录名",
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
                      text: { tag: "plain_text", content: config.submitLabel },
                      type: "primary",
                      form_action_type: "submit",
                      name: "btn_project_submit",
                      behaviors: [{ type: "callback", value: callbackValue }],
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
                      name: "btn_project_cancel",
                      behaviors: [{ type: "callback", value: { action: "project_cancel" } }],
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
  return buildProjectFormCard({
    headerTitle: "创建项目",
    submitLabel: "创建",
    callbackAction: "project_create",
    folderPlaceholder: "留空则由 AI 自动生成",
  })
}

export function buildProjectEditCard(project: Project): Record<string, unknown> {
  return buildProjectFormCard({
    headerTitle: "编辑项目",
    submitLabel: "保存",
    callbackAction: "project_edit",
    projectId: project.id,
    folderRequired: true,
    defaults: {
      title: project.title,
      description: project.description ?? "",
      folderName: project.folderName,
    },
  })
}

export function buildProjectListCard(
  projects: Project[],
  currentProjectId?: string,
): Record<string, unknown> {
  const items: ListItem[] = projects.map((p) => ({
    label: truncate(p.title, 40),
    description: p.description ? truncate(p.description, 60) : undefined,
    isCurrent: currentProjectId !== undefined && p.id === currentProjectId,
    icon: { token: "folder_outlined" },
    time: format(new Date(p.updatedAt), "yyyy-MM-dd HH:mm:ss"),
    callbackValue: { action: "project_select", project_id: p.id },
  }))
  return buildListCard(items)
}
