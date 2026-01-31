import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";

export type SseStreamOptions = {
  streamUrl: string;
  sendUrl?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  retryDelayMs?: number;
  maxRetries?: number;
};

export function createSseStream(options: SseStreamOptions): Stream {
  const readable = createReadableStream(options);
  const writable = createWritableStream(options);
  return { readable, writable };
}

function createReadableStream(
  options: SseStreamOptions,
): ReadableStream<AnyMessage> {
  const {
    streamUrl,
    headers,
    signal,
    heartbeatIntervalMs = 15000,
    heartbeatTimeoutMs = 45000,
    retryDelayMs = 1000,
    maxRetries = Number.POSITIVE_INFINITY,
  } = options;
  return new ReadableStream<AnyMessage>({
    async start(controller) {
      let cancelled = false;
      const cancel = (error?: unknown) => {
        if (cancelled) {
          return;
        }
        cancelled = true;
        if (error) {
          controller.error(error);
          return;
        }
        controller.close();
      };

      if (signal) {
        if (signal.aborted) {
          cancel();
          return;
        }
        signal.addEventListener("abort", () => cancel());
      }

      let attempt = 0;
      while (!cancelled) {
        const abortController = new AbortController();
        const abortListener = () => abortController.abort();
        signal?.addEventListener("abort", abortListener, { once: true });

        try {
          await readSseConnection({
            streamUrl,
            headers,
            controller,
            signal: abortController.signal,
            heartbeatIntervalMs,
            heartbeatTimeoutMs,
          });
          attempt = 0;
        } catch (error) {
          if (cancelled || signal?.aborted) {
            cancel();
            break;
          }
          attempt += 1;
          if (attempt > maxRetries) {
            cancel(error);
            break;
          }
          await delay(nextRetryDelay(attempt, retryDelayMs));
        } finally {
          signal?.removeEventListener("abort", abortListener);
        }
      }
    },
    cancel() {
      return undefined;
    },
  });
}

function createWritableStream(
  options: SseStreamOptions,
): WritableStream<AnyMessage> {
  const { sendUrl, streamUrl, headers, signal } = options;
  const targetUrl = sendUrl ?? streamUrl;

  return new WritableStream<AnyMessage>({
    async write(message) {
      const sendHeaders: Record<string, string> = {
        "content-type": "application/json",
      };
      if (headers) {
        Object.assign(sendHeaders, headers);
      }

      const init: RequestInit = {
        method: "POST",
        headers: sendHeaders,
        body: JSON.stringify(message),
      };
      if (signal) {
        init.signal = signal;
      }

      const response = await fetch(targetUrl, init);

      if (!response.ok) {
        throw new Error(`SSE send failed: ${response.status}`);
      }
    },
  });
}

function flushEvent(
  eventData: string[],
  controller: ReadableStreamDefaultController<AnyMessage>,
): void {
  if (eventData.length === 0) {
    return;
  }

  const payload = eventData.join("\n").trim();
  if (!payload) {
    return;
  }

  try {
    const message = JSON.parse(payload) as AnyMessage;
    controller.enqueue(message);
  } catch (error) {
    controller.error(error);
  }
}

async function readSseConnection(options: {
  streamUrl: string;
  headers?: Record<string, string>;
  controller: ReadableStreamDefaultController<AnyMessage>;
  signal: AbortSignal;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}): Promise<void> {
  const {
    streamUrl,
    headers,
    controller,
    signal,
    heartbeatIntervalMs,
    heartbeatTimeoutMs,
  } = options;
  const decoder = new TextDecoder();
  const init: RequestInit = { signal };
  if (headers) {
    init.headers = headers;
  }

  const response = await fetch(streamUrl, init);

  if (!response.ok || !response.body) {
    throw new Error(`SSE connection failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  let buffer = "";
  let eventData: string[] = [];
  let lastMessageAt = Date.now();
  let stale = false;
  const heartbeatTimer = setInterval(() => {
    if (Date.now() - lastMessageAt > heartbeatTimeoutMs) {
      stale = true;
      void reader.cancel();
    }
  }, heartbeatIntervalMs);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      lastMessageAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          flushEvent(eventData, controller);
          eventData = [];
          continue;
        }

        if (line.startsWith("data:")) {
          eventData.push(line.slice(5).trimStart());
        }
      }
    }

    flushEvent(eventData, controller);
  } finally {
    clearInterval(heartbeatTimer);
    reader.releaseLock();
  }

  if (stale) {
    throw new Error("SSE heartbeat timeout");
  }

  throw new Error("SSE connection closed");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function nextRetryDelay(attempt: number, baseDelay: number): number {
  const maxDelay = 30000;
  const delay = baseDelay * Math.pow(2, Math.min(attempt - 1, 5));
  return Math.min(delay, maxDelay);
}
