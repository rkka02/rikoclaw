import type Database from "better-sqlite3";
import { listCurated } from "../persistence/repos/curated-repo.js";
import { listMemoryEventsInRange } from "../persistence/repos/event-repo.js";
import { getCore } from "../persistence/repos/core-repo.js";
import { renderDeltaMemoryXml, renderFullMemoryXml } from "./xml-renderer.js";
import type { CuratedMemory, PrepareMode, PrepareTurnResponse } from "./types.js";

export function compilePreparePayload(input: {
  db: Database.Database;
  modeId: string;
  fromRevision: number;
  toRevision: number;
  prepareId: string;
}): PrepareTurnResponse {
  const { db, modeId, fromRevision, toRevision, prepareId } = input;

  if (toRevision <= fromRevision) {
    return {
      prepareId,
      mode: "none",
      fromRevision,
      toRevision,
      xml: "",
    };
  }

  if (fromRevision <= 0) {
    const core = getCore(db, modeId);
    const curated = listCurated(db, modeId);
    const xml = renderFullMemoryXml({
      modeId,
      revision: toRevision,
      core,
      curated,
    });

    return {
      prepareId,
      mode: "full",
      fromRevision,
      toRevision,
      xml,
    };
  }

  const events = listMemoryEventsInRange(db, {
    modeId,
    fromRevisionExclusive: fromRevision,
    toRevisionInclusive: toRevision,
  });
  if (events.length === 0) {
    return {
      prepareId,
      mode: "none",
      fromRevision,
      toRevision,
      xml: "",
    };
  }

  let coreUpdated = false;
  const curatedTouched = new Set<string>();
  const curatedDeleted = new Set<string>();

  for (const event of events) {
    if (event.eventType === "core_upsert") {
      coreUpdated = true;
      continue;
    }

    if (!event.memoryId) {
      continue;
    }

    curatedTouched.add(event.memoryId);
    if (event.eventType === "curated_delete") {
      curatedDeleted.add(event.memoryId);
    } else {
      curatedDeleted.delete(event.memoryId);
    }
  }

  const curatedUpserts: CuratedMemory[] = [];
  for (const memoryId of curatedTouched) {
    if (curatedDeleted.has(memoryId)) {
      continue;
    }
    const current = db
      .prepare(
        `SELECT mode_id, memory_id, name, description, detail, is_deleted, updated_at
         FROM curated_memory
         WHERE mode_id = ? AND memory_id = ? AND is_deleted = 0`,
      )
      .get(modeId, memoryId) as
      | {
          mode_id: string;
          memory_id: string;
          name: string;
          description: string;
          detail: string;
          is_deleted: number;
          updated_at: number;
        }
      | undefined;

    if (!current) {
      curatedDeleted.add(memoryId);
      continue;
    }

    curatedUpserts.push({
      modeId: current.mode_id,
      memoryId: current.memory_id,
      name: current.name,
      description: current.description,
      detail: current.detail,
      isDeleted: false,
      updatedAt: Number(current.updated_at),
    });
  }

  const core = coreUpdated ? getCore(db, modeId) : null;
  const xml = renderDeltaMemoryXml({
    modeId,
    fromRevision,
    toRevision,
    coreUpdated: core,
    curatedUpserts,
    curatedRemovedIds: Array.from(curatedDeleted.values()).sort(),
  });

  const mode: PrepareMode = xml.trim() ? "delta" : "none";

  return {
    prepareId,
    mode,
    fromRevision,
    toRevision,
    xml: mode === "none" ? "" : xml,
  };
}
