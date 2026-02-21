---
name: skill-creator
description: Create or update AgentSkills. Use when designing, structuring, or packaging skills with scripts, references, and assets. Triggers on keywords like "skill", "create skill", "new skill", "스킬", "스킬 만들기", "skill template".
---

# Skill Creator

This skill provides guidance for creating effective skills.

## About Skills

Skills are modular, self-contained packages that extend the bot's capabilities by providing specialized knowledge, workflows, and tools. They transform the bot from a general-purpose agent into a specialized agent equipped with procedural knowledge that no model can fully possess.

Skills provide: (1) Specialized workflows, (2) Tool integrations, (3) Domain expertise, (4) Bundled resources (scripts, references, assets).

## Core Principles

### Concise is Key

The context window is a public good. **The bot is already very smart.** Only add context the bot doesn't already have. Challenge each piece: "Does this paragraph justify its token cost?" Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom

- **High freedom** (text instructions): Multiple valid approaches, context-dependent
- **Medium freedom** (pseudocode/scripts with params): Preferred pattern exists, some variation OK
- **Low freedom** (specific scripts): Fragile operations, consistency critical

### Anatomy of a Skill

See [Skill Anatomy Reference](./references/skill-anatomy.md) for the complete guide on structure, SKILL.md format, and bundled resources.

Key points:
- **SKILL.md** = YAML frontmatter (`name` + `description` only) + Markdown body
- **Frontmatter** is always in context; body only loads after triggering
- **scripts/**: Deterministic executable code; **references/**: Docs loaded on demand; **assets/**: Output files (templates, images)
- Do NOT create README.md, CHANGELOG.md, or other extraneous docs

### Progressive Disclosure

See [Progressive Disclosure Reference](./references/progressive-disclosure.md) for loading patterns and examples.

Three-level loading: metadata (always) → body (on trigger) → resources (on demand). Keep SKILL.md body under 500 lines. Move variant-specific details to reference files.

## Skill Creation Process

1. Understand the skill with concrete examples
2. Plan reusable skill contents (scripts, references, assets)
3. Initialize the skill (run init_skill.py)
4. Edit the skill (implement resources and write SKILL.md)
5. Package the skill (run package_skill.py)
6. Iterate based on real usage

Follow in order; skip only with clear reason.

### Skill Naming

- Lowercase letters, digits, hyphens only (e.g., "Plan Mode" → `plan-mode`)
- Under 64 characters; prefer short, verb-led phrases
- Namespace by tool when helpful (e.g., `gh-address-comments`)
- Folder name = skill name

### Step 1: Understanding with Concrete Examples

Skip only when usage patterns are already clear. Ask questions like:
- "What functionality should this skill support?"
- "Can you give examples of how this would be used?"
- "What would a user say that should trigger this skill?"

### Step 2: Planning Reusable Contents

Analyze each example: (1) how to execute from scratch, (2) what scripts/references/assets help with repeated execution.

Example: `pdf-editor` → `scripts/rotate_pdf.py` (same rotation code rewritten each time)
Example: `frontend-webapp-builder` → `assets/hello-world/` template (same boilerplate each time)
Example: `big-query` → `references/schema.md` (re-discovering schemas each time)

### Step 3: Initializing the Skill

Skip if skill already exists. Run `init_skill.py`:

```bash
scripts/init_skill.py <skill-name> --path <output-dir> [--resources scripts,references,assets] [--examples]
```

After initialization, customize SKILL.md and add resources. Delete unused placeholder files.

### Step 4: Edit the Skill

The skill is for another bot instance. Include non-obvious procedural knowledge.

**Design patterns**: See [references/workflows.md](./references/workflows.md) for multi-step processes and [references/output-patterns.md](./references/output-patterns.md) for output format guidance.

**Implementation order**: Start with reusable resources (scripts, references, assets), then update SKILL.md.

**SKILL.md frontmatter**: Only `name` and `description`. Description is the primary trigger mechanism — include what the skill does AND when to use it. Do not include other fields.

**SKILL.md body**: Write instructions for using the skill and its bundled resources. Use imperative form.

**Test scripts** by running them to verify correctness.

### Step 5: Packaging

```bash
scripts/package_skill.py <path/to/skill-folder> [output-dir]
```

Validates (frontmatter, naming, structure, description quality) then packages into a `.skill` file (zip format). Fix any validation errors and re-run.

### Step 6: Iterate

1. Use the skill on real tasks → 2. Notice struggles → 3. Update SKILL.md or resources → 4. Test again
