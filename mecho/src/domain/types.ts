export type PrepareMode = "full" | "delta" | "none";

export interface CoreMemory {
  modeId: string;
  name: string;
  description: string;
  detail: string;
  updatedAt: number;
}

export interface CuratedMemory {
  modeId: string;
  memoryId: string;
  name: string;
  description: string;
  detail: string;
  isDeleted: boolean;
  updatedAt: number;
}

export interface MemoryEvent {
  id: number;
  modeId: string;
  rev: number;
  eventType: "core_upsert" | "curated_upsert" | "curated_delete";
  memoryId: string | null;
  payloadJson: string;
  createdAt: number;
}

export interface PrepareTurnResponse {
  prepareId: string;
  mode: PrepareMode;
  fromRevision: number;
  toRevision: number;
  xml: string;
}
