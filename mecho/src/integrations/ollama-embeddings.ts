import type { MechoConfig } from "../config.js";

export async function embedTextWithOllama(config: MechoConfig, text: string): Promise<number[]> {
  const prompt = text.trim();
  if (!prompt) {
    throw new Error("embedding input text is empty");
  }

  const baseUrl = config.ollamaUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollamaTimeoutMs);

  try {
    const legacy = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaEmbedModel,
        prompt,
      }),
      signal: controller.signal,
    });

    if (legacy.ok) {
      const parsed = extractEmbedding(await legacy.json());
      if (parsed.length > 0) {
        return parsed;
      }
      throw new Error("ollama returned empty embedding from /api/embeddings");
    }

    if (legacy.status !== 404) {
      const body = await safeText(legacy);
      throw new Error(`ollama /api/embeddings failed (${legacy.status}): ${body}`);
    }

    const modern = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaEmbedModel,
        input: prompt,
      }),
      signal: controller.signal,
    });
    if (!modern.ok) {
      const body = await safeText(modern);
      throw new Error(`ollama /api/embed failed (${modern.status}): ${body}`);
    }

    const parsed = extractEmbedding(await modern.json());
    if (parsed.length === 0) {
      throw new Error("ollama returned empty embedding from /api/embed");
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function extractEmbedding(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const data = payload as Record<string, unknown>;

  if (Array.isArray(data.embedding)) {
    return sanitizeVector(data.embedding);
  }

  if (Array.isArray(data.embeddings)) {
    const first = data.embeddings[0];
    if (Array.isArray(first)) {
      return sanitizeVector(first);
    }
    return sanitizeVector(data.embeddings);
  }

  if (Array.isArray(data.data) && data.data.length > 0) {
    const first = data.data[0] as unknown;
    if (first && typeof first === "object") {
      const maybe = (first as Record<string, unknown>).embedding;
      if (Array.isArray(maybe)) {
        return sanitizeVector(maybe);
      }
    }
  }

  return [];
}

function sanitizeVector(input: unknown[]): number[] {
  const out: number[] = [];
  for (const value of input) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push(value);
      continue;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        out.push(parsed);
      }
    }
  }
  return out;
}

async function safeText(response: { text(): Promise<string> }): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text || "(empty body)";
  } catch {
    return "(failed to read body)";
  }
}
