# Scheduled Code Review Design

> Created: 2026-05-23
> Status: Approved

## Overview

A daily scheduled task at 3:00 AM that performs automated code review on the ClawBench project. The review covers 10 dimensions across priorities, generates structured reports, and tracks Critical issues through a lifecycle.

## Basic Configuration

| Item | Value |
|------|-------|
| Schedule | `0 3 * * *` (daily at 3:00 AM) |
| Agent | `assistant` |
| Mode | Incremental (Mon-Sat) / Full scan (Sun replaces incremental) |
| Exclusions | `.worktrees/`, `vendor/`, `*_test.go`, `__tests__/`, `public/` |

## Review Dimensions & Priority

| Priority | Dimension | Focus |
|----------|-----------|-------|
| **P0** | Flow Correctness | Data flow completeness, error handling gaps, boundary conditions |
| **P0** | Security | Command injection, path traversal, auth coverage, password handling |
| **P1** | Architecture Rationality | Clear layering, single responsibility, dependency direction |
| **P1** | Concurrency Safety | Race conditions, goroutine leaks, deadlocks |
| **P1** | Error Handling & Resource Leak | Error propagation, resource cleanup, zombie processes |
| **P2** | Dead Code | Unused functions/variables/imports, deprecated branches |
| **P2** | API Contract Consistency | SSE event format alignment, request/response struct sync |
| **P3** | Code Reuse | Duplicate logic extraction, composable/util reuse |
| **P3** | Hardcoded Values & Magic Numbers | Scattered config, hardcoded ports/timeouts/thresholds |
| **P3** | Observability | Critical path logging, error traceability |

**Execution limit**: P0 blocks must all complete. P1/P2/P3 covered by priority, truncated on timeout.

## Execution Flow

### Step 1 — Determine Mode

- **Sunday** → Full scan: enumerate all non-excluded `.go` / `.vue` / `.ts` files
- **Other days** → Incremental: `git diff review-{last-tag}..HEAD` to get changed files

### Step 2 — Flow Tracing

For incremental reviews:

1. Start from changed files
2. Dynamically analyze import chains and call relationships
3. Derive which flows each changed file belongs to
4. Include upstream/downstream files in the flow scope (may span frontend and backend)
5. The flow tracing is performed by AI reading changed files and following import/call chains — no pre-defined flow map is maintained

### Step 3 — Generate Review Plan

- Output: `.clawbench/reviews/{date}/plan.md`
- Content: ordered list of review blocks, each containing:
  - Block number
  - File range (≤ 500 lines per block)
  - Flow name (e.g., "Chat Data Flow", "SSH Tunnel", "Scheduled Task")
  - Dimension focus for this block
  - Priority level
- Blocks sorted by priority (P0 first), within same priority by flow grouping

### Step 4 — Execute Review Block by Block

For each block:

1. Read the code in the block's file range
2. Review against the dimension focus
3. Output findings with severity: **Critical** / **Warning** / **Info**
4. Write result to `.clawbench/reviews/{date}/block-{n}.md`
5. Critical findings → also write to `.clawbench/issues/{id}.md`

### Step 5 — Generate Summary Report

- Output: `.clawbench/reviews/{date}/report.md`
- Statistics: findings per dimension, Critical count, issue distribution by flow
- After report generation, tag the commit: `git tag review-{date}`

## Incremental Baseline

- After each successful review, a git tag `review-{date}` is created
- Next incremental review uses `git diff review-{last-tag}..HEAD`
- If no tag exists (first run), treat as full scan

## Issue Lifecycle

```
[Review finds Critical]
       ↓
[Auto-create Issue file] → .clawbench/issues/ISS-{nnn}.md
       ↓
[Next Review: detect code change] → Mark "Suspected Resolved"
       ↓
[User next-day review] → Confirm resolved / Reject as false positive
       ↓
[Mark ISS file: resolved / rejected]
```

- **Create**: Review finds Critical issue → auto-generate Issue (description, severity, files, dimension)
- **Track**: Next Review auto-detects if Issue-related code has changed → mark "Suspected Resolved"
- **Close**: User confirms during next-day review → mark resolved; or rejects as false positive → mark rejected
- **Review entry**: `.clawbench/reviews/{date}/report.md` lists all findings for user to confirm/reject

## Directory Structure

```
.clawbench/
├── reviews/
│   └── 2026-05-23/
│       ├── plan.md          # Review plan
│       ├── block-01.md      # Block 1 review result
│       ├── block-02.md      # Block 2 review result
│       ├── ...
│       └── report.md        # Summary report
└── issues/
    ├── ISS-001.md           # Critical Issue
    ├── ISS-002.md
    └── ...
```

## Block File Format (block-{n}.md)

```markdown
# Review Block {n}: {flow name}

**Files**: {file list}
**Lines**: {start}-{end} ({count} lines)
**Dimension Focus**: {dimension name} (P{level})

## Findings

### Critical
- [CRIT-001] {description} ({file}:{line})
  - **Impact**: {why this is critical}
  - **Suggestion**: {how to fix}

### Warning
- [WARN-001] {description}

### Info
- [INFO-001] {description}
```

## Issue File Format (ISS-{nnn}.md)

```markdown
---
id: ISS-{nnn}
status: open
severity: critical
dimension: {dimension name}
created: {date}
files: [{file list}]
---

## Description
{problem description}

## Impact
{why this matters}

## Suggestion
{how to fix}

## History
- {date}: Created by review {review-date}
- {date}: Suspected resolved (code changed in {file})
- {date}: Confirmed resolved by user
```

## Report File Format (report.md)

```markdown
# Code Review Report — {date}

**Mode**: {Full Scan | Incremental}
**Baseline Tag**: {review-tag or "N/A (first run)"}
**Blocks Executed**: {n}/{total}
**Truncation**: {None | "P2 and below truncated after block {n}"}

## Summary Statistics

| Dimension | Critical | Warning | Info |
|-----------|----------|---------|------|
| P0 - Flow Correctness | {n} | {n} | {n} |
| P0 - Security | {n} | {n} | {n} |
| ... | ... | ... | ... |

## Issues by Flow

### {flow name}
- [CRIT-001] {description} → ISS-{nnn}
- [WARN-001] {description}

## Open Issues from Previous Reviews
{list of unresolved issues with status}

## Next Steps
- [ ] Review findings and confirm/reject
- [ ] Address Critical issues
- [ ] Tag applied: `review-{date}`
```

## Agent Prompt Design

The scheduled task prompt must instruct the AI agent to:

1. Determine review mode (Sunday = full, else = incremental)
2. For incremental: find the latest `review-*` tag and compute diff
3. Perform flow tracing from changed files
4. Generate plan file at `.clawbench/reviews/{date}/plan.md`
5. Execute blocks in priority order, respecting the 500-line limit
6. For Critical findings, create Issue files
7. Check existing Issues for suspected resolution
8. Generate summary report
9. Tag the current commit

The prompt should be self-contained and repeat all rules each execution.
