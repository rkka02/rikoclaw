import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EngineManager } from "../src/core/engine-manager.ts";

function withManager(run, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerotwo_claw-engine-test-"));
  const overridesPath = path.join(tempDir, "engine-overrides.json");

  if (options.overrides) {
    const payload = { overrides: options.overrides };
    fs.writeFileSync(overridesPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  const manager = new EngineManager({
    dataDir: tempDir,
  });

  try {
    run(manager, { tempDir, overridesPath });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("stores engine overrides by user+context", () => {
  withManager((manager) => {
    assert.equal(manager.getEngine("100", "th_A"), "claude");
    assert.equal(manager.getEngine("100", "th_B"), "claude");

    manager.setEngine("100", "th_A", "codex");
    assert.equal(manager.getEngine("100", "th_A"), "codex");
    assert.equal(manager.getEngine("100", "th_B"), "claude");

    manager.setEngine("100", "th_A", "claude");
    assert.equal(manager.getEngine("100", "th_A"), "claude");
  });
});

test("legacy user-global override falls back until first scoped write", () => {
  withManager(
    (manager, { overridesPath }) => {
      assert.equal(manager.getEngine("200", "th_A"), "codex");
      assert.equal(manager.getEngine("200", "th_B"), "codex");

      manager.setEngine("200", "th_A", "codex");
      assert.equal(manager.getEngine("200", "th_A"), "codex");
      assert.equal(manager.getEngine("200", "th_B"), "claude");

      const raw = fs.readFileSync(overridesPath, "utf8");
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed.overrides, {
        "200:th_A": "codex",
      });
    },
    {
      overrides: {
        "200": "codex",
      },
    },
  );
});
