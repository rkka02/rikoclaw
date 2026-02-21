import type { ZodError, ZodIssue } from "zod";

export function formatValidationError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return "invalid request";
  }

  const message = formatTooBigStringIssue(issue);
  if (message) {
    return message;
  }

  return issue.message || "invalid request";
}

function formatTooBigStringIssue(issue: ZodIssue): string | null {
  if (issue.code !== "too_big") {
    return null;
  }

  const maybeStringIssue = issue as ZodIssue & {
    type?: unknown;
    maximum?: unknown;
  };
  if (maybeStringIssue.type !== "string" || typeof maybeStringIssue.maximum !== "number") {
    return null;
  }

  return `The character limit for this memory is ${maybeStringIssue.maximum}. If more content is needed, read this memory in full and compact sections that can be compacted to make space. Do not skip this just because it is tedious; do it diligently.`;
}
