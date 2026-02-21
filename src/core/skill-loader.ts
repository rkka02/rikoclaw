import fs from "node:fs";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
}

/**
 * Scan a directory for skills and return metadata for each.
 *
 * Recognises two layouts:
 *  1. sub-folder with SKILL.md  →  skills/foo/SKILL.md
 *  2. standalone .md at root    →  skills/bar.md  (not named SKILL.md)
 */
export function loadSkillsFromDir(dir: string): Skill[] {
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    return [];
  }

  const skills: Skill[] = [];
  const entries = fs.readdirSync(resolved, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      const skillMd = path.join(resolved, entry.name, "SKILL.md");
      if (fs.existsSync(skillMd)) {
        const parsed = parseFrontmatter(skillMd);
        if (parsed) {
          skills.push({
            name: parsed.name,
            description: parsed.description,
            filePath: skillMd,
            baseDir: path.join(resolved, entry.name),
          });
        }
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      entry.name !== "SKILL.md"
    ) {
      const mdPath = path.join(resolved, entry.name);
      const parsed = parseFrontmatter(mdPath);
      if (parsed) {
        skills.push({
          name: parsed.name,
          description: parsed.description,
          filePath: mdPath,
          baseDir: resolved,
        });
      }
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build an XML block describing available skills for the system prompt.
 * Returns an empty string when the list is empty.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }

  const header =
    "The following skills provide specialized instructions for specific tasks.\n" +
    "Use the Read tool to load a skill's file when the task matches its description.";

  const items = skills
    .map(
      (s) =>
        `  <skill>\n    <name>${escapeXml(s.name)}</name>\n    <description>${escapeXml(s.description)}</description>\n    <location>${escapeXml(s.filePath)}</location>\n  </skill>`,
    )
    .join("\n");

  return `${header}\n\n<available_skills>\n${items}\n</available_skills>`;
}

// ── Internal helpers ─────────────────────────────────────

interface Frontmatter {
  name: string;
  description: string;
}

function parseFrontmatter(filePath: string): Frontmatter | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  if (!content.startsWith("---")) {
    return null;
  }

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return null;
  }

  const yaml = content.slice(4, endIndex);
  const name = extractYamlValue(yaml, "name");
  const description = extractYamlValue(yaml, "description");

  if (!name || !description) {
    return null;
  }

  return { name, description };
}

function extractYamlValue(yaml: string, key: string): string {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = yaml.match(regex);
  if (!match) {
    return "";
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
