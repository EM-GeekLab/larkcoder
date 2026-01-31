import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AgentClient } from "../src/acp/acpClient.js";
import type { ContainerOrchestratorClient } from "../src/container/orchestrator.js";
import {
  type AgentClientFactoryOptions,
  WorkflowOrchestrator,
} from "../src/workflow/orchestrator.js";
import { InMemoryStateStore } from "../src/workflow/store.js";

describe("WorkflowOrchestrator", () => {
  it("allows valid transitions", async () => {
    const store = new InMemoryStateStore();
    const orchestrator = new WorkflowOrchestrator(store, {
      containerOrchestrator: createContainerStub(),
      acpClientFactory: createAcpClientStub,
    });
    await orchestrator.createTask("task-1");

    const planning = await orchestrator.transition("task-1", "Planning");
    expect(planning.state).toBe("Planning");

    const coding = await orchestrator.transition("task-1", "Coding");
    expect(coding.state).toBe("Coding");

    const completed = await orchestrator.transition("task-1", "Completed");
    expect(completed.state).toBe("Completed");
  });

  it("rejects invalid transitions", async () => {
    const store = new InMemoryStateStore();
    const orchestrator = new WorkflowOrchestrator(store, {
      containerOrchestrator: createContainerStub(),
      acpClientFactory: createAcpClientStub,
    });
    await orchestrator.createTask("task-2");

    await expect(
      orchestrator.transition("task-2", "Completed"),
    ).rejects.toThrow("Invalid transition");
  });

  it("includes telemetry summary in workflow cards", async () => {
    const store = new InMemoryStateStore();
    const postMessageCard = vi.fn(async () => undefined);
    const larkClient = {
      postMessageCard,
    } as unknown as import("../src/lark/larkClient.js").LarkClient;
    const orchestrator = new WorkflowOrchestrator(store, {
      containerOrchestrator: createContainerStub(),
      acpClientFactory: createStreamingAcpClientStub,
      larkClient,
    });

    await orchestrator.createTask("task-telemetry", {
      planContext: "Plan",
      messageCardReceiveId: "oc_1",
      messageCardReceiveIdType: "open_id",
    });

    await orchestrator.startCoding("task-telemetry");

    await waitFor(() => postMessageCard.mock.calls.length > 1);
    const calls = postMessageCard.mock.calls as unknown as Array<
      [{ card: Record<string, unknown> }]
    >;
    const lastCall = calls.length > 0 ? calls[calls.length - 1] : undefined;
    const card = lastCall?.[0]?.card;
    if (!card) {
      throw new Error("Expected Lark card update");
    }
    const elements = Array.isArray(card?.elements)
      ? (card?.elements as Array<Record<string, unknown>>)
      : [];
    const markdownElement = elements.find((element) => element.tag === "markdown");
    const content = markdownElement?.content as string | undefined;
    expect(content).toContain("**Activity:**");
  });
});

function createContainerStub(): ContainerOrchestratorClient {
  return {
    launchAgent: async () => ({
      id: "container-1",
      name: "agent-test",
      command: "docker run",
      image: "agent-image",
    }),
    stopAgent: async () => undefined,
    streamAgentLogs: async () => ({
      stream: new PassThrough(),
      stop: () => undefined,
    }),
  };
}

function createAcpClientStub(_options: AgentClientFactoryOptions): AgentClient {
  return {
    initialize: async () => ({ protocolVersion: 1 }),
    newSession: async () => ({ sessionId: "session-1" }),
    sendPrompt: async () => ({ stopReason: "end_turn" }),
    interrupt: async () => undefined,
    toolCallResult: async () => ({}),
    agentCapabilities: undefined,
    clientCapabilities: undefined,
  };
}

function createStreamingAcpClientStub(
  options: AgentClientFactoryOptions,
): AgentClient {
  return {
    initialize: async () => ({ protocolVersion: 1 }),
    newSession: async () => ({ sessionId: "session-telemetry" }),
    sendPrompt: async () => {
      await options.onSessionUpdate({
        sessionId: "session-telemetry",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Working..." },
        },
      });
      return { stopReason: "end_turn" };
    },
    interrupt: async () => undefined,
    toolCallResult: async () => ({}),
    agentCapabilities: undefined,
    clientCapabilities: undefined,
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
