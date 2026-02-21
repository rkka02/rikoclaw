import type { CoreMemory, CuratedMemory } from "./types.js";

export function renderFullMemoryXml(input: {
  modeId: string;
  revision: number;
  core: CoreMemory | null;
  curated: CuratedMemory[];
}): string {
  const lines: string[] = [];
  lines.push(`<memory_context mode_id="${escapeAttr(input.modeId)}" revision="${input.revision}">`);

  if (input.core) {
    lines.push("  <core>");
    lines.push(`    <name>${escapeText(input.core.name)}</name>`);
    lines.push(`    <description>${escapeText(input.core.description)}</description>`);
    lines.push("  </core>");
  }

  lines.push("  <curated_memories>");
  for (const memory of input.curated) {
    lines.push(`    <memory memory_id="${escapeAttr(memory.memoryId)}">`);
    lines.push(`      <name>${escapeText(memory.name)}</name>`);
    lines.push(`      <description>${escapeText(memory.description)}</description>`);
    lines.push("    </memory>");
  }
  lines.push("  </curated_memories>");
  lines.push("</memory_context>");

  return lines.join("\n");
}

export function renderDeltaMemoryXml(input: {
  modeId: string;
  fromRevision: number;
  toRevision: number;
  coreUpdated: CoreMemory | null;
  curatedUpserts: CuratedMemory[];
  curatedRemovedIds: string[];
}): string {
  const lines: string[] = [];
  lines.push(
    `<memory_delta mode_id="${escapeAttr(input.modeId)}" from_revision="${input.fromRevision}" to_revision="${input.toRevision}">`,
  );

  if (input.coreUpdated) {
    lines.push("  <core_updated>");
    lines.push(`    <name>${escapeText(input.coreUpdated.name)}</name>`);
    lines.push(`    <description>${escapeText(input.coreUpdated.description)}</description>`);
    lines.push("  </core_updated>");
  }

  for (const memory of input.curatedUpserts) {
    lines.push(`  <curated_upsert memory_id="${escapeAttr(memory.memoryId)}">`);
    lines.push(`    <name>${escapeText(memory.name)}</name>`);
    lines.push(`    <description>${escapeText(memory.description)}</description>`);
    lines.push("  </curated_upsert>");
  }

  for (const removedId of input.curatedRemovedIds) {
    lines.push(`  <curated_removed memory_id="${escapeAttr(removedId)}" />`);
  }

  lines.push("</memory_delta>");
  return lines.join("\n");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
