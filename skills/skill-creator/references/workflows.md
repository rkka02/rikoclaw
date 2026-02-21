# Multi-Step Workflow Patterns

## Sequential Workflow

For skills with ordered steps where each depends on the previous:

```markdown
## Process

### Step 1: Gather inputs
Collect X, Y, Z from the user.

### Step 2: Validate
Check constraints A, B, C.

### Step 3: Execute
Run the operation with validated inputs.

### Step 4: Verify
Confirm output matches expectations.
```

## Conditional Workflow

For skills where the path depends on context:

```markdown
## Process

### Determine approach
- If condition A: follow [Path A](#path-a)
- If condition B: follow [Path B](#path-b)

### Path A
[specific steps]

### Path B
[specific steps]
```

## Iterative Workflow

For skills that loop until quality is achieved:

```markdown
## Process

1. Generate initial output
2. Evaluate against criteria
3. If criteria not met, refine and go to step 2
4. Deliver final output
```

## Tips

- Number steps explicitly for sequential workflows
- Use decision trees or if/else for conditional paths
- Set maximum iteration limits for iterative workflows
- Include rollback/error-recovery steps for fragile operations
