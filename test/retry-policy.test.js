import test from "node:test";
import assert from "node:assert/strict";
import { isSessionResumeError, isTransientApiError } from "../src/core/retry-policy.ts";

test("detects explicit session-not-found style resume errors", () => {
  assert.equal(isSessionResumeError("No such session: thread_abc"), true);
  assert.equal(isSessionResumeError("thread not found for resume"), true);
  assert.equal(isSessionResumeError("Failed to resume conversation"), true);
});

test("detects korean session/thread resume errors", () => {
  assert.equal(isSessionResumeError("세션을 찾을 수 없습니다."), true);
  assert.equal(isSessionResumeError("스레드가 유효하지 않습니다."), true);
  assert.equal(isSessionResumeError("재개 실패: 세션 만료"), true);
});

test("does not treat generic 'session' mentions as resume errors", () => {
  assert.equal(isSessionResumeError("OpenAI API key is missing for this session."), false);
  assert.equal(isSessionResumeError("세션 요약을 생성했습니다."), false);
  assert.equal(isSessionResumeError("session started successfully"), false);
});

test("detects transient API/server errors", () => {
  assert.equal(
    isTransientApiError('API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}'),
    true,
  );
  assert.equal(isTransientApiError("HTTP 503 Service Unavailable"), true);
  assert.equal(isTransientApiError("Gateway timeout from upstream"), true);
});

test("does not treat non-transient client errors as transient", () => {
  assert.equal(isTransientApiError("API Error: 401 invalid auth"), false);
  assert.equal(isTransientApiError("invalid_request_error: model not found"), false);
});
