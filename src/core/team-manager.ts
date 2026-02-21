import type { Client, TextBasedChannel, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { BotContext } from "../bot.js";
import type { RunResult } from "./llm-runner.js";
import type { QueueManager } from "./queue-manager.js";

// ── Interfaces ──────────────────────────────────────────

export interface TeamStep {
  index: number;
  label: string;
  model: string;
  modeName: string;
  task: string;
}

export interface TeamRun {
  id: string;
  channelId: string;
  threadId: string | null;
  userId: string;
  steps: TeamStep[];
  currentStep: number;
  status: "planning" | "awaiting_approval" | "running" | "done" | "failed";
  handoffs: string[];
  originalPrompt: string;
  startedAt: number;
  stepStartedAt: number | null;
}

// ── Parsing prompt ──────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `너는 멀티스텝 작업 플래너다. 유저의 자연어 지시를 구조화된 JSON 파이프라인으로 변환하라.

출력 형식 (반드시 JSON만 출력):
{
  "steps": [
    {
      "label": "작업 설명 (한줄)",
      "model": "claude-opus-4-6 | claude-sonnet-4-5-20250929",
      "modeName": "default | business | research | ...",
      "task": "상세 작업 지시문"
    }
  ]
}

규칙:
- 모델명이 약칭이면 정식 모델ID로 변환 (opus → claude-opus-4-6, opus-4-6 → claude-opus-4-6, sonnet → claude-sonnet-4-5-20250929, sonnet-4-5 → claude-sonnet-4-5-20250929)
- 모드가 명시되지 않으면 "default"
- 각 step의 task는 구체적이고 실행 가능하게 작성
- JSON 외 텍스트 출력 금지`;

// ── Approval keywords ───────────────────────────────────

const APPROVAL_WORDS = new Set([
  "응", "ㅇ", "ㅇㅇ", "yes", "y", "고", "go", "ㄱ", "ㄱㄱ",
  "ok", "확인", "진행", "시작", "넹", "네", "좋아", "ㅇㅋ",
]);

export function isApprovalMessage(content: string): boolean {
  return APPROVAL_WORDS.has(content.trim().toLowerCase());
}

// ── TeamManager ─────────────────────────────────────────

let nextId = 1;
function generateId(): string {
  return `team_${Date.now()}_${nextId++}`;
}

export class TeamManager {
  private readonly runs = new Map<string, TeamRun>();

  constructor(
    private readonly client: Client,
    private readonly queue: QueueManager,
  ) { }

  // ── Planning ────────────────────────────────────────

  async startPlanning(
    channel: TextBasedChannel,
    userId: string,
    instruction: string,
    ctx: BotContext,
  ): Promise<TeamRun> {
    const runner = ctx.runners.get("claude");
    if (!runner) {
      throw new Error("Claude runner를 찾을 수 없습니다.");
    }

    const result = await runner.run({
      prompt: instruction,
      systemPrompt: PLAN_SYSTEM_PROMPT,
      model: "claude-sonnet-4-5-20250929",
    });

    if (!result.success || !result.text.trim()) {
      throw new Error(result.error || "파이프라인 파싱에 실패했습니다.");
    }

    const parsed = this.parseSteps(result.text);
    if (parsed.length === 0) {
      throw new Error("파싱된 step이 없습니다. 지시를 더 구체적으로 해주세요.");
    }

    const run: TeamRun = {
      id: generateId(),
      channelId: channel.id,
      threadId: null,
      userId,
      steps: parsed,
      currentStep: 0,
      status: "awaiting_approval",
      handoffs: [],
      originalPrompt: instruction,
      startedAt: Date.now(),
      stepStartedAt: null,
    };

    this.runs.set(run.id, run);

    // Send plan embed
    const embed = this.buildPlanEmbed(run);
    const send = (channel as { send?: (options: unknown) => Promise<unknown> }).send;
    if (typeof send === "function") {
      await send.call(channel, {
        embeds: [embed],
        content: "이렇게 진행할까요? (응/yes로 승인, 아니면 취소됩니다)",
      });
    }

    return run;
  }

  // ── Approval ────────────────────────────────────────

  getPendingApproval(channelId: string, userId: string): TeamRun | null {
    for (const run of this.runs.values()) {
      if (
        run.channelId === channelId &&
        run.userId === userId &&
        run.status === "awaiting_approval"
      ) {
        return run;
      }
    }
    return null;
  }

  async handleApproval(channelId: string, userId: string, ctx: BotContext): Promise<void> {
    const run = this.getPendingApproval(channelId, userId);
    if (!run) {
      return;
    }

    // Create thread
    const channel = this.client.channels.cache.get(channelId) as TextChannel | undefined;
    if (!channel || !("threads" in channel)) {
      throw new Error("스레드를 생성할 수 없는 채널입니다.");
    }

    const thread = await channel.threads.create({
      name: `Team: ${run.originalPrompt.slice(0, 80)}`,
      autoArchiveDuration: 1440,
    });

    run.threadId = thread.id;
    run.status = "running";

    await thread.send(
      `**Team Pipeline** 시작 (${run.steps.length} steps)\n원본 지시: ${run.originalPrompt}`,
    );

    this.executeStep(run, thread, ctx);
  }

  // ── Execution ───────────────────────────────────────

  private executeStep(run: TeamRun, thread: TextBasedChannel, ctx: BotContext): void {
    const step = run.steps[run.currentStep];
    if (!step) {
      this.completeRun(run, thread);
      return;
    }

    run.stepStartedAt = Date.now();

    // Send step start message
    const startMsg = [
      `**Step ${step.index + 1}/${run.steps.length}: ${step.label}**`,
      `모델: \`${step.model}\` | 모드: \`${step.modeName}\``,
      "━━━━━━━━━━━━━━━━━━",
    ].join("\n");

    const sendToThread = (thread as { send?: (content: string) => Promise<unknown> }).send;
    if (typeof sendToThread === "function") {
      void sendToThread.call(thread, startMsg);
    }

    // Build prompt with handoff context
    const prompt = this.buildStepPrompt(run, step);
    const taskKey = `team:${run.id}:step${step.index}`;

    this.queue.enqueue({
      prompt,
      sessionId: null,
      model: step.model,
      taskKey,
      respondTo: { type: "channel", channel: thread },
      createdAt: Date.now(),
      engine: "claude",
      modeName: step.modeName,
      onComplete: (result: RunResult) => {
        this.onStepComplete(run, step, result, thread, ctx);
      },
    });
  }

  private onStepComplete(
    run: TeamRun,
    step: TeamStep,
    result: RunResult,
    thread: TextBasedChannel,
    ctx: BotContext,
  ): void {
    const elapsed = run.stepStartedAt ? Date.now() - run.stepStartedAt : 0;
    const elapsedStr = formatDuration(elapsed);

    const sendToThread = (thread as { send?: (content: string) => Promise<unknown> }).send;
    const send = (msg: string): void => {
      if (typeof sendToThread === "function") {
        void sendToThread.call(thread, msg);
      }
    };

    if (!result.success) {
      run.status = "failed";
      send(
        [
          `**Step ${step.index + 1}/${run.steps.length} 실패**`,
          result.error || "알 수 없는 오류",
          "파이프라인이 중단되었습니다.",
        ].join("\n"),
      );
      this.notifyOriginalChannel(run, `Team 파이프라인 실패 (Step ${step.index + 1}에서 중단)`);
      return;
    }

    // Extract handoff
    const handoff = extractHandoff(result.text);
    run.handoffs[step.index] = handoff || "(handoff 없음)";

    // Post step completion
    const handoffPreview = handoff
      ? handoff.length > 200 ? `${handoff.slice(0, 200)}...` : handoff
      : "(handoff 없음)";

    send(
      [
        `**Step ${step.index + 1}/${run.steps.length} 완료** (${elapsedStr})`,
        `> ${handoffPreview}`,
        "━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    );

    // Move to next step
    run.currentStep += 1;
    if (run.currentStep < run.steps.length) {
      this.executeStep(run, thread, ctx);
    } else {
      this.completeRun(run, thread);
    }
  }

  private completeRun(run: TeamRun, thread: TextBasedChannel): void {
    run.status = "done";
    const totalElapsed = formatDuration(Date.now() - run.startedAt);

    const sendToThread = (thread as { send?: (content: string) => Promise<unknown> }).send;
    if (typeof sendToThread === "function") {
      void sendToThread.call(
        thread,
        `**파이프라인 완료** (${run.steps.length} steps, 총 ${totalElapsed})`,
      );
    }

    this.notifyOriginalChannel(
      run,
      `Team 파이프라인 완료! (${run.steps.length} steps, 총 ${totalElapsed})\n스레드: <#${run.threadId}>`,
    );
  }

  getActiveRun(channelId: string, userId: string): TeamRun | null {
    for (const run of this.runs.values()) {
      if (
        run.channelId === channelId &&
        run.userId === userId &&
        (run.status === "running" || run.status === "awaiting_approval")
      ) {
        return run;
      }
    }
    return null;
  }

  cancelRun(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.status === "done" || run.status === "failed") {
      return false;
    }

    const wasRunning = run.status === "running";
    run.status = "failed";

    // 실행 중이었으면 현재 step의 큐 작업도 취소
    if (wasRunning) {
      const step = run.steps[run.currentStep];
      if (step) {
        const taskKey = `team:${run.id}:step${step.index}`;
        this.queue.cancel(taskKey);
      }
    }

    return true;
  }

  // ── Helpers ─────────────────────────────────────────

  private buildStepPrompt(run: TeamRun, step: TeamStep): string {
    const parts: string[] = [];

    // Previous handoff
    if (step.index > 0 && run.handoffs[step.index - 1]) {
      parts.push(
        `<previous_handoff>\n${run.handoffs[step.index - 1]}\n</previous_handoff>`,
      );
    }

    // Current task
    parts.push(`[현재 작업]\n${step.task}`);

    // Handoff instruction
    const nextStep = run.steps[step.index + 1];
    const nextInfo = nextStep
      ? `다음 작업: "${nextStep.label}" (${nextStep.model}, ${nextStep.modeName} 모드)`
      : "이것이 마지막 작업입니다. 최종 결과물을 정리하라.";

    parts.push(
      [
        "[중요: 컨텍스트 인계]",
        "작업 완료 후 반드시 <handoff> 태그 안에 다음 내용을 정리하라 (본인이 마지막 작업자인 경우 결과물 정리만):",
        "1. 이번 작업의 핵심 결과물 (파일 경로, 결정사항 등)",
        "2. 다음 작업자가 반드시 알아야 할 컨텍스트",
        "3. 미해결 이슈나 주의사항",
        nextInfo,
      ].join("\n"),
    );

    return parts.join("\n\n");
  }

  private buildPlanEmbed(run: TeamRun): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle("Team Pipeline Plan")
      .setDescription(run.originalPrompt)
      .setColor(0x5865f2);

    for (const step of run.steps) {
      embed.addFields({
        name: `Step ${step.index + 1}: ${step.label}`,
        value: `모델: \`${step.model}\`\n모드: \`${step.modeName}\`\n작업: ${step.task.slice(0, 950)}`,
      });
    }

    embed.setFooter({ text: `총 ${run.steps.length} steps` });
    return embed;
  }

  private parseSteps(text: string): TeamStep[] {
    // Try to extract JSON from the response
    let json: { steps?: unknown[] } | null = null;

    // Try direct parse first
    try {
      json = JSON.parse(text.trim()) as { steps?: unknown[] };
    } catch {
      // Try to find JSON in the text
      const jsonMatch = text.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          json = JSON.parse(jsonMatch[0]) as { steps?: unknown[] };
        } catch {
          // noop
        }
      }
    }

    if (!json || !Array.isArray(json.steps)) {
      return [];
    }

    return json.steps.map((raw, index) => {
      const step = raw as {
        label?: string;
        model?: string;
        modeName?: string;
        task?: string;
      };
      return {
        index,
        label: step.label || `Step ${index + 1}`,
        model: step.model || "claude-sonnet-4-5-20250929",
        modeName: step.modeName || "default",
        task: step.task || "",
      };
    });
  }

  private notifyOriginalChannel(run: TeamRun, message: string): void {
    const channel = this.client.channels.cache.get(run.channelId);
    if (!channel) {
      return;
    }
    const send = (channel as { send?: (content: string) => Promise<unknown> }).send;
    if (typeof send === "function") {
      void send.call(channel, message);
    }
  }
}

// ── Utility ─────────────────────────────────────────────

function extractHandoff(text: string): string | null {
  const match = text.match(/<handoff>([\s\S]*?)<\/handoff>/);
  return match ? match[1].trim() : null;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0s";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
