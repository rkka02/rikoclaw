export function splitMessage(text: string, maxLength: number = 1990): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeLang = "";

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      if (inCodeBlock) {
        // 마지막 청크가 코드블록 내에서 시작하는 경우,
        // 내용의 코드블록 상태를 확인하여 적절히 처리한다.
        const state = resolveCodeBlockState(remaining, inCodeBlock, codeLang);
        const prefix = `\`\`\`${codeLang}\n`;
        const suffix = state.inCodeBlock ? "\n```" : "";
        chunks.push(prefix + remaining + suffix);
      } else {
        chunks.push(remaining);
      }
      break;
    }

    const prefix = inCodeBlock ? `\`\`\`${codeLang}\n` : "";
    const hardLimit = Math.max(200, maxLength - prefix.length - 4);
    let cutAt = hardLimit;

    const lastNewline = remaining.lastIndexOf("\n", hardLimit);
    if (lastNewline > hardLimit * 0.5) {
      cutAt = lastNewline;
    }

    const chunkBody = remaining.slice(0, cutAt);
    const state = resolveCodeBlockState(chunkBody, inCodeBlock, codeLang);

    const suffix = state.inCodeBlock ? "\n```" : "";
    chunks.push(prefix + chunkBody + suffix);

    remaining = remaining.slice(cutAt);
    inCodeBlock = state.inCodeBlock;
    codeLang = state.codeLang;
  }

  return chunks;
}

export function formatError(error: string, isTimeout: boolean): string {
  const emoji = isTimeout ? "⏱️" : "❌";
  return `${emoji} ${error}`;
}

export function formatQueueStatus(position: number): string {
  return `⏳ 대기열 ${position}번째. 잠시 기다려주세요.`;
}

function resolveCodeBlockState(
  chunk: string,
  initialInCodeBlock: boolean,
  initialLang: string,
): { inCodeBlock: boolean; codeLang: string } {
  const lines = chunk.split("\n");
  let inCodeBlock = initialInCodeBlock;
  let codeLang = initialLang;

  for (const line of lines) {
    if (!line.startsWith("```")) {
      continue;
    }

    if (inCodeBlock) {
      inCodeBlock = false;
      codeLang = "";
      continue;
    }

    inCodeBlock = true;
    codeLang = line.slice(3).trim();
  }

  return { inCodeBlock, codeLang };
}
