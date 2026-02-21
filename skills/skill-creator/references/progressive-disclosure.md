# Progressive Disclosure Design Principle

Skills use a three-level loading system to manage context efficiently:

1. **Metadata (name + description)** - Always in context (~100 words)
2. **SKILL.md body** - When skill triggers (<5k words)
3. **Bundled resources** - As needed by the bot (unlimited; scripts can be executed without reading into context)

## Patterns

### Pattern 1: High-level guide with references

```markdown
# PDF Processing

## Quick start
Extract text with pdfplumber:
[code example]

## Advanced features
- **Form filling**: See [FORMS.md](FORMS.md) for complete guide
- **API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
```

The bot loads FORMS.md or REFERENCE.md only when needed.

### Pattern 2: Domain-specific organization

For skills with multiple domains, organize content by domain:

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md
    ├── sales.md
    └── product.md
```

Similarly, for skills supporting multiple frameworks:

```
cloud-deploy/
├── SKILL.md (workflow + provider selection)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

### Pattern 3: Conditional details

Show basic content, link to advanced content:

```markdown
# DOCX Processing

## Creating documents
Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents
For simple edits, modify the XML directly.
**For tracked changes**: See [REDLINING.md](REDLINING.md)
```

## Guidelines

- Keep SKILL.md body under 500 lines; split content into separate files when approaching this limit
- Avoid deeply nested references; keep references one level deep from SKILL.md
- For files longer than 100 lines, include a table of contents at the top
- When splitting content, always reference the new files from SKILL.md with clear descriptions of when to read them
