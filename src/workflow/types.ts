import type {
  AgentCapabilities,
  ClientCapabilities,
} from "@agentclientprotocol/sdk";

export type WorkflowState =
  | "Idle"
  | "Planning"
  | "Coding"
  | "Reviewing"
  | "Completed";

export type WorkflowLogEntry = {
  at: string;
  type:
    | "agent_message"
    | "agent_thought"
    | "tool_call"
    | "tool_call_update"
    | "plan"
    | "system"
    | "error";
  message?: string;
  data?: Record<string, unknown>;
};

export type TaskData = {
  docToken?: string;
  docTokenType?: "docx" | "wiki" | "auto";
  planMarkdown?: string;
  planContext?: string;
  repoUrl?: string;
  branchName?: string;
  authVolume?: string;
  agentConfig?: string;
  variables?: Record<string, string>;
  agentHost?: string;
  agentPort?: number;
  messageCardReceiveId?: string;
  messageCardReceiveIdType?: string;
  githubRepository?: string;
  githubBaseBranch?: string;
  githubHeadBranch?: string;
  containerName?: string;
  containerId?: string;
  workingDir?: string;
  sessionId?: string;
  agentCapabilities?: AgentCapabilities;
  clientCapabilities?: ClientCapabilities;
  logs?: WorkflowLogEntry[];
  pr?: {
    url?: string;
    requestedAt?: string;
    status?: "requested" | "created" | "failed";
    error?: string;
  };
  ci?: {
    status?: string;
    conclusion?: string;
    updatedAt?: string;
  };
};

export type TaskRecord = {
  taskId: string;
  state: WorkflowState;
  createdAt: string;
  updatedAt: string;
  data?: TaskData;
};
