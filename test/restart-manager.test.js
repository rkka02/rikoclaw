import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RESTART_DIRECTIVE_FILE_NAME,
  RestartManager,
} from "../src/core/restart-manager.ts";

function withManager(run, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerotwo_claw-restart-test-"));
  const manager = new RestartManager({
    dataDir: tempDir,
    selfRestartEnabled: options.selfRestartEnabled ?? true,
    selfRestartCommand: options.selfRestartCommand ?? "echo restart",
    selfRestartDelaySec: options.selfRestartDelaySec ?? 3,
    selfRestartMaxPendingMinutes: options.selfRestartMaxPendingMinutes ?? 60,
    selfRestartLaunchLabel: options.selfRestartLaunchLabel ?? "com.zerotwo_claw.test",
  });

  try {
    run(manager, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("readDirective parses restart json from output directory", () => {
  withManager((manager, tempDir) => {
    const outDir = path.join(tempDir, "turn-output");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, RESTART_DIRECTIVE_FILE_NAME),
      JSON.stringify(
        {
          reason: "runtime code changed",
          resume_prompt: "restart 완료 후 테스트를 이어서 실행해.",
          delay_sec: "5",
        },
        null,
        2,
      ),
      "utf8",
    );

    const parsed = manager.readDirective(outDir);
    assert.equal(parsed.error, null);
    assert.equal(parsed.directive?.reason, "runtime code changed");
    assert.equal(parsed.directive?.resumePrompt, "restart 완료 후 테스트를 이어서 실행해.");
    assert.equal(parsed.directive?.delaySec, 5);
    assert.deepEqual(parsed.consumedFileNames, [".zerotwo_claw-restart.json"]);
  });
});

test("readDirective falls back to restart-like json files", () => {
  withManager((manager, tempDir) => {
    const outDir = path.join(tempDir, "turn-output");
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(
      path.join(outDir, "agent-result.json"),
      JSON.stringify(
        {
          restart: true,
          reason: "apply patch",
          resumePrompt: "restart 후 테스트 재실행",
        },
        null,
        2,
      ),
      "utf8",
    );

    const parsed = manager.readDirective(outDir);
    assert.equal(parsed.error, null);
    assert.equal(parsed.directive?.reason, "apply patch");
    assert.equal(parsed.directive?.resumePrompt, "restart 후 테스트 재실행");
    assert.deepEqual(parsed.consumedFileNames, ["agent-result.json"]);
  });
});

test("readDirectiveFromText parses inline restart json", () => {
  withManager((manager) => {
    const parsed = manager.readDirectiveFromText(
      '{"restart":true,"reason":"code updated","resumePrompt":"continue task"}',
    );
    assert.equal(parsed?.reason, "code updated");
    assert.equal(parsed?.resumePrompt, "continue task");
  });
});

test("scheduleRestart is skipped when self restart is disabled", () => {
  withManager(
    (manager) => {
      const result = manager.scheduleRestart({
        channelId: "123",
        userId: "u1",
        contextId: "ch_1",
        sessionUserId: "u1",
        engine: "claude",
        sessionId: "sess-1",
        model: null,
        modeName: "default",
        mechoModeId: null,
        reason: "need restart",
        resumePrompt: "continue",
        delaySec: 3,
      });
      assert.equal(result.status, "disabled");
    },
    {
      selfRestartEnabled: false,
    },
  );
});

test("peekPendingResume returns valid state and clears expired state", () => {
  withManager((manager, tempDir) => {
    const pendingPath = path.join(tempDir, "restart-pending.json");
    const now = Date.now();
    const validState = {
      version: 1,
      pending: {
        id: "restart_1",
        requestedAt: now,
        channelId: "123",
        userId: "u1",
        contextId: "ch_1",
        sessionUserId: "u1",
        engine: "claude",
        sessionId: "sess-1",
        model: null,
        modeName: "default",
        mechoModeId: null,
        reason: "apply code",
        resumePrompt: "resume prompt",
      },
    };
    fs.writeFileSync(pendingPath, `${JSON.stringify(validState, null, 2)}\n`, "utf8");

    const pending = manager.peekPendingResume();
    assert.equal(pending?.id, "restart_1");

    const expiredState = {
      ...validState,
      pending: {
        ...validState.pending,
        id: "restart_old",
        requestedAt: now - 61 * 60 * 1000,
      },
    };
    fs.writeFileSync(pendingPath, `${JSON.stringify(expiredState, null, 2)}\n`, "utf8");

    const expired = manager.peekPendingResume();
    assert.equal(expired, null);
    assert.equal(fs.existsSync(pendingPath), false);
  });
});
