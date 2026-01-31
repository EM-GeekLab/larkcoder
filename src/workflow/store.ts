import { createClient, type RedisClientType } from "redis";
import type { TaskRecord } from "./types.js";

export interface StateStore {
  get(taskId: string): Promise<TaskRecord | null>;
  set(record: TaskRecord): Promise<void>;
  getTaskIdByDocToken?(docToken: string): Promise<string | null>;
  setDocTokenMapping?(docToken: string, taskId: string): Promise<void>;
  list(): Promise<TaskRecord[]>;
  close?: () => Promise<void>;
}

export class InMemoryStateStore implements StateStore {
  private records = new Map<string, TaskRecord>();
  private docTokenToTaskId = new Map<string, string>();

  async get(taskId: string): Promise<TaskRecord | null> {
    return this.records.get(taskId) ?? null;
  }

  async set(record: TaskRecord): Promise<void> {
    this.records.set(record.taskId, record);
    const docToken = record.data?.docToken;
    if (docToken) {
      this.docTokenToTaskId.set(docToken, record.taskId);
    }
  }

  async getTaskIdByDocToken(docToken: string): Promise<string | null> {
    return this.docTokenToTaskId.get(docToken) ?? null;
  }

  async setDocTokenMapping(docToken: string, taskId: string): Promise<void> {
    this.docTokenToTaskId.set(docToken, taskId);
  }

  async list(): Promise<TaskRecord[]> {
    return Array.from(this.records.values());
  }
}

export type RedisStateStoreOptions = {
  url: string;
  keyPrefix?: string;
};

export class RedisStateStore implements StateStore {
  private client: RedisClientType;
  private ready: Promise<void>;
  private keyPrefix: string;
  private docTokenPrefix: string;

  constructor(options: RedisStateStoreOptions) {
    this.client = createClient({ url: options.url });
    this.keyPrefix = options.keyPrefix ?? "autocoder:tasks:";
    this.docTokenPrefix = `${this.keyPrefix}doc-token:`;
    this.ready = this.client.connect().then(() => undefined);
  }

  async get(taskId: string): Promise<TaskRecord | null> {
    await this.ready;
    const value = await this.client.get(this.key(taskId));
    if (!value) {
      return null;
    }
    return parseTaskRecord(value);
  }

  async set(record: TaskRecord): Promise<void> {
    await this.ready;
    await this.client.set(this.key(record.taskId), JSON.stringify(record));
    const docToken = record.data?.docToken;
    if (docToken) {
      await this.client.set(this.docTokenKey(docToken), record.taskId);
    }
  }

  async getTaskIdByDocToken(docToken: string): Promise<string | null> {
    await this.ready;
    const value = await this.client.get(this.docTokenKey(docToken));
    return value ?? null;
  }

  async setDocTokenMapping(docToken: string, taskId: string): Promise<void> {
    await this.ready;
    await this.client.set(this.docTokenKey(docToken), taskId);
  }

  async list(): Promise<TaskRecord[]> {
    await this.ready;
    const keys = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length === 0) {
      return [];
    }

    const values = await this.client.mGet(keys);
    const records: TaskRecord[] = [];
    for (const value of values) {
      if (!value) {
        continue;
      }
      records.push(parseTaskRecord(value));
    }
    return records;
  }

  async close(): Promise<void> {
    await this.ready;
    await this.client.quit();
  }

  private key(taskId: string): string {
    return `${this.keyPrefix}${taskId}`;
  }

  private docTokenKey(docToken: string): string {
    return `${this.docTokenPrefix}${docToken}`;
  }
}

function parseTaskRecord(raw: string): TaskRecord {
  try {
    const parsed = JSON.parse(raw) as TaskRecord;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid task record");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse task record: ${String(error)}`);
  }
}
