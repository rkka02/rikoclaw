# Anatomy of a Skill

Every skill consists of a required SKILL.md file and optional bundled resources:

```
skill-name/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Python/Bash/etc.)
    ├── references/       - Documentation intended to be loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
```

## SKILL.md (required)

Every SKILL.md consists of:

- **Frontmatter** (YAML): Contains `name` and `description` fields. These are the only fields that the bot reads to determine when the skill gets used, thus it is very important to be clear and comprehensive in describing what the skill is, and when it should be used.
- **Body** (Markdown): Instructions and guidance for using the skill. Only loaded AFTER the skill triggers (if at all).

## Bundled Resources (optional)

### Scripts (`scripts/`)

Executable code (Python/Bash/etc.) for tasks that require deterministic reliability or are repeatedly rewritten.

- **When to include**: When the same code is being rewritten repeatedly or deterministic reliability is needed
- **Example**: `scripts/rotate_pdf.py` for PDF rotation tasks
- **Benefits**: Token efficient, deterministic, may be executed without reading into context
- **Note**: Scripts may still need to be read by the bot for patching or environment-specific adjustments

### References (`references/`)

Documentation and reference material intended to be loaded as needed into context.

- **When to include**: For documentation that the bot should reference while working
- **Examples**: `references/finance.md` for financial schemas, `references/api_docs.md` for API specifications
- **Best practice**: If files are large (>10k words), include grep search patterns in SKILL.md
- **Avoid duplication**: Information should live in either SKILL.md or references files, not both. Prefer references for detailed information.

### Assets (`assets/`)

Files not intended to be loaded into context, but used within the output.

- **When to include**: When the skill needs files that will be used in the final output
- **Examples**: `assets/logo.png`, `assets/slides.pptx`, `assets/frontend-template/`
- **Benefits**: Separates output resources from documentation

## What to Not Include

Do NOT create extraneous documentation: README.md, INSTALLATION_GUIDE.md, QUICK_REFERENCE.md, CHANGELOG.md, etc. Skills should only contain information needed for an AI agent to do the job.
