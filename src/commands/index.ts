import {
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotContext } from "../bot.js";
import * as admin from "./admin.js";
import * as mode from "./mode.js";
import * as engine from "./engine.js";
import * as model from "./model.js";
import * as newChat from "./new-chat.js";
import * as schedule from "./schedule.js";
import * as stop from "./stop.js";
import * as team from "./team.js";
import * as verbose from "./verbose.js";

interface CommandData {
  name: string;
  toJSON: () => unknown;
}

interface CommandModule {
  data: CommandData | CommandData[];
  execute: (
    interaction: ChatInputCommandInteraction,
    ctx: BotContext,
  ) => Promise<void>;
}

export const commands: CommandModule[] = [
  newChat,
  stop,
  model,
  engine,
  verbose,
  schedule,
  admin,
  team,
  mode,
];

export async function registerCommands(
  clientId: string,
  token: string,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.flatMap((command) => {
    const data = Array.isArray(command.data) ? command.data : [command.data];
    return data.map((item) => item.toJSON());
  });

  await rest.put(Routes.applicationCommands(clientId), { body });
}
