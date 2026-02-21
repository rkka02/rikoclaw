import fs from "node:fs";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { ClaudeRunner } from "./core/claude-runner.js";
import { CodexRunner } from "./core/codex-runner.js";
import { EngineManager } from "./core/engine-manager.js";
import { HeartbeatManager } from "./core/heartbeat-manager.js";
import type { LLMRunner } from "./core/llm-runner.js";
import { ModelManager } from "./core/model-manager.js";
import { MechoModeManager } from "./core/mecho-mode-manager.js";
import { PersonaManager } from "./core/persona-manager.js";
import { QueueManager } from "./core/queue-manager.js";
import { ScheduleManager } from "./core/schedule-manager.js";
import { SessionManager } from "./core/session-manager.js";
import { TeamManager } from "./core/team-manager.js";
import { PTYRelayManager } from "./core/pty-relay-manager.js";
import { VerboseManager } from "./core/verbose-manager.js";
import { RestartManager } from "./core/restart-manager.js";
import type { Config } from "./utils/config.js";

export interface BotContext {
  config: Config;
  runners: Map<string, LLMRunner>;
  queue: QueueManager;
  sessions: SessionManager;
  personas: PersonaManager;
  schedules: ScheduleManager;
  heartbeat: HeartbeatManager;
  models: ModelManager;
  mechoModes: MechoModeManager;
  engines: EngineManager;
  team: TeamManager;
  verbose: VerboseManager;
  ptyRelay: PTYRelayManager;
  restarts: RestartManager;
}

export function createClient(config: Config): Client {
  const intents: number[] = [GatewayIntentBits.Guilds];

  // Message-based UX requires message events; MessageContent is privileged and must be explicitly enabled.
  if (config.enableMentionResponse) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages);
    if (config.discordMessageContentIntent) {
      intents.push(GatewayIntentBits.MessageContent);
    } else {
      console.warn(
        "[discord] DISCORD_MESSAGE_CONTENT_INTENT is false; message content may be missing. " +
          "If you want mention-based prompts, enable Message Content Intent in the Discord Developer Portal " +
          "and set DISCORD_MESSAGE_CONTENT_INTENT=true.",
      );
    }
  }

  return new Client({
    intents,
    partials: [Partials.Channel],
  });
}

export async function createContext(config: Config, client: Client): Promise<BotContext> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.personasDir, { recursive: true });
  fs.mkdirSync(config.claudeOutputDir, { recursive: true });
  fs.mkdirSync(config.claudeInputDir, { recursive: true });
  fs.mkdirSync(config.skillsDir, { recursive: true });

  const runners = new Map<string, LLMRunner>();
  runners.set("claude", new ClaudeRunner(config));

  if (config.codexEnabled) {
    try {
      runners.set("codex", new CodexRunner(config));
      console.log("[codex] runner registered");
    } catch (error: unknown) {
      console.warn("[codex] runner initialization failed, codex engine disabled:", error);
    }
  }

  const sessions = new SessionManager(config.dbPath);
  const models = new ModelManager(config);
  const mechoModes = new MechoModeManager(config);
  const engines = new EngineManager(config);
  const personas = new PersonaManager(config);
  const verbose = new VerboseManager(config);
  const restarts = new RestartManager(config);
  const queue = new QueueManager(
    runners,
    sessions,
    config,
    verbose,
    personas,
    mechoModes,
    restarts,
  );
  const schedules = new ScheduleManager(client, personas, queue, sessions);
  const heartbeat = new HeartbeatManager(client, config, personas, queue, sessions);
  const team = new TeamManager(client, queue);
  const ptyRelay = new PTYRelayManager(config, sessions);

  return {
    config,
    runners,
    queue,
    sessions,
    personas,
    schedules,
    heartbeat,
    models,
    mechoModes,
    engines,
    team,
    verbose,
    ptyRelay,
    restarts,
  };
}
