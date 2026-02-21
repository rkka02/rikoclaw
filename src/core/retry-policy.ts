const SESSION_RESUME_ERROR_PATTERNS: RegExp[] = [
  /\b(no such|unknown|missing|invalid|expired)\s+(session|thread|conversation)\b/i,
  /\b(session|thread|conversation)\s+(not found|does not exist|is invalid|invalid|expired|missing)\b/i,
  /\b(failed|unable|cannot|can't)\s+to\s+resume\b(?:\s+(session|thread|conversation))?/i,
  /\bresume\b.*\b(session|thread|conversation)\b.*\b(failed|error|invalid|not found|expired|missing)\b/i,
  /\b(session|thread)_id\b.*\b(invalid|not found|missing)\b/i,
  /세션.{0,20}(찾을 수 없|없음|없습니다|유효하지|만료|실패|오류)/,
  /스레드.{0,20}(찾을 수 없|없음|없습니다|유효하지|만료|실패|오류)/,
  /재개.{0,20}(실패|오류|불가|불가능)/,
];

const TRANSIENT_API_ERROR_PATTERNS: RegExp[] = [
  /\bapi error:\s*5\d{2}\b/i,
  /\bhttp\s*5\d{2}\b/i,
  /\btype["']?\s*:\s*["']api_error["']/i,
  /\binternal server error\b/i,
  /\bservice unavailable\b/i,
  /\bgateway timeout\b/i,
  /\bbad gateway\b/i,
  /\boverloaded\b/i,
  /\btemporarily unavailable\b/i,
];

export function isSessionResumeError(errorText: string): boolean {
  const normalized = errorText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  return SESSION_RESUME_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isMaxTurnsError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return lower.includes("error_max_turns") || lower.includes("max_turns");
}

export function isCancelledError(errorText: string): boolean {
  const lower = errorText.toLowerCase();
  return lower.includes("cancel") || lower.includes("abort") || lower.includes("중단");
}

export function isTransientApiError(errorText: string): boolean {
  const normalized = errorText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }

  return TRANSIENT_API_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}
