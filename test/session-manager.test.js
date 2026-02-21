import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "../src/core/session-manager.ts";

function withManager(run) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rikoclaw-session-test-"));
  const dbPath = path.join(tempDir, "sessions.db");
  const manager = new SessionManager(dbPath);
  try {
    run(manager);
  } finally {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("claimMessageEvent accepts first claim and rejects duplicate in window", () => {
  withManager((manager) => {
    const now = 1_700_000_000_000;
    const windowMs = 120_000;

    assert.equal(manager.claimMessageEvent("m_1", windowMs, now), true);
    assert.equal(manager.claimMessageEvent("m_1", windowMs, now + 1_000), false);
  });
});

test("claimMessageEvent allows re-claim after dedup window", () => {
  withManager((manager) => {
    const now = 1_700_000_000_000;
    const windowMs = 120_000;

    assert.equal(manager.claimMessageEvent("m_2", windowMs, now), true);
    assert.equal(manager.claimMessageEvent("m_2", windowMs, now + windowMs + 1), true);
  });
});
