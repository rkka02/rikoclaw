import type { EngineType } from "../core/llm-runner.js";

export interface MechoConfigLike {
  mechoEnabled: boolean;
  mechoApiUrl: string;
  mechoTimeoutMs: number;
  mechoDefaultModeId: string;
}

export interface MechoPrepareInput {
  modeId: string;
  sessionKey: string;
  engine: EngineType;
  forceFull?: boolean;
}

export interface MechoPrepareResult {
  prepareId: string;
  mode: "full" | "delta" | "none";
  fromRevision: number;
  toRevision: number;
  xml: string;
}

export interface MechoAckInput {
  modeId: string;
  prepareId: string;
  sessionKey: string;
  status: "success" | "failed";
}

export interface MechoModeListResult {
  ok: boolean;
  modes: string[];
}

export interface MechoModeCreateResult {
  ok: boolean;
  modeId: string;
  created: boolean;
}

export interface MechoModeDeleteResult {
  ok: boolean;
  modeId: string;
  deleted: boolean;
}

export class MechoClient {
  constructor(private readonly config: MechoConfigLike) {}

  get enabled(): boolean {
    return this.config.mechoEnabled;
  }

  async prepareTurn(input: MechoPrepareInput): Promise<MechoPrepareResult | null> {
    if (!this.enabled) {
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mechoTimeoutMs);

    try {
      const url = `${this.config.mechoApiUrl}/v1/turn/prepare`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`prepare failed (${res.status})`);
      }

      const json = (await res.json()) as MechoPrepareResult;
      if (!json || !json.prepareId || !json.mode) {
        throw new Error("invalid prepare response");
      }
      return json;
    } catch (error: unknown) {
      throw this.normalizeNetworkError(error, "prepare", `${this.config.mechoApiUrl}/v1/turn/prepare`);
    } finally {
      clearTimeout(timer);
    }
  }

  async ackTurn(input: MechoAckInput): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mechoTimeoutMs);

    try {
      const url = `${this.config.mechoApiUrl}/v1/turn/ack`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`ack failed (${res.status})`);
      }
    } catch (error: unknown) {
      throw this.normalizeNetworkError(error, "ack", `${this.config.mechoApiUrl}/v1/turn/ack`);
    } finally {
      clearTimeout(timer);
    }
  }

  async listModes(): Promise<MechoModeListResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mechoTimeoutMs);

    try {
      const url = `${this.config.mechoApiUrl}/v1/mode/list`;
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`mode list failed (${res.status}): ${await safeErrorText(res)}`);
      }
      return (await res.json()) as MechoModeListResult;
    } catch (error: unknown) {
      throw this.normalizeNetworkError(error, "mode list", `${this.config.mechoApiUrl}/v1/mode/list`);
    } finally {
      clearTimeout(timer);
    }
  }

  async createMode(modeId: string): Promise<MechoModeCreateResult> {
    const cleanModeId = this.resolveModeId(modeId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mechoTimeoutMs);

    try {
      const url = `${this.config.mechoApiUrl}/v1/mode/create`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modeId: cleanModeId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`mode create failed (${res.status}): ${await safeErrorText(res)}`);
      }
      return (await res.json()) as MechoModeCreateResult;
    } catch (error: unknown) {
      throw this.normalizeNetworkError(error, "mode create", `${this.config.mechoApiUrl}/v1/mode/create`);
    } finally {
      clearTimeout(timer);
    }
  }

  async deleteMode(modeId: string): Promise<MechoModeDeleteResult> {
    const cleanModeId = this.resolveModeId(modeId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.mechoTimeoutMs);

    try {
      const url = `${this.config.mechoApiUrl}/v1/mode/delete`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modeId: cleanModeId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`mode delete failed (${res.status}): ${await safeErrorText(res)}`);
      }
      return (await res.json()) as MechoModeDeleteResult;
    } catch (error: unknown) {
      throw this.normalizeNetworkError(error, "mode delete", `${this.config.mechoApiUrl}/v1/mode/delete`);
    } finally {
      clearTimeout(timer);
    }
  }

  resolveModeId(value: string | null | undefined): string {
    const clean = (value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    return clean || this.config.mechoDefaultModeId;
  }

  private normalizeNetworkError(error: unknown, op: string, url: string): Error {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return new Error(
          `${op} request timed out after ${this.config.mechoTimeoutMs}ms (${url})`,
        );
      }
      if (error.message === "fetch failed") {
        return new Error(
          `${op} request could not reach mecho API (${url}). Is the mecho server running?`,
        );
      }
      return error;
    }
    return new Error(`${op} request failed (${url})`);
  }
}

export function buildMechoSessionKey(input: {
  modeId: string;
  engine: EngineType;
  userId: string;
  contextId: string;
}): string {
  return `${input.modeId}:${input.engine}:${input.userId}:${input.contextId}`;
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return text || "(empty body)";
  } catch {
    return "(failed to read response body)";
  }
}
