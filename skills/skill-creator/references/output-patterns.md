# Output Format Patterns

## Template-Based Output

For skills that produce structured output (reports, documents, code):

```markdown
## Output Template

### Report Title
**Date**: {date}
**Author**: {author}

### Summary
{executive_summary}

### Details
{detailed_findings}

### Recommendations
{action_items}
```

## Example-Based Output

For skills where showing a complete example is more effective than a template:

```markdown
## Example Output

Here is a complete example of the expected output:

[full example with annotations explaining each section]
```

## Quality Criteria

Define measurable quality standards for skill output:

- Specify format requirements (JSON, Markdown, HTML, etc.)
- Include length guidelines (concise vs. comprehensive)
- Define required sections or fields
- Provide anti-patterns (what NOT to do)

## Tips

- Use concrete examples over abstract templates when possible
- If output format is strict, provide a complete example
- If output format is flexible, provide quality criteria instead
- Include both good and bad examples when the distinction is subtle
