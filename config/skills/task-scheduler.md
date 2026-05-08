---
name: task-scheduler
description: Create, update, delete, pause, resume, and trigger scheduled tasks via clawbench task CLI.
  Triggers on: scheduled task, cron job, recurring, periodic, timer, 定时任务, 定期执行, 周期性, 计划任务
condition: scheduler.enabled
triggers:
  - Creating a scheduled or recurring task
  - Setting up a cron job
  - Periodic execution of a task
  - User mentions "schedule", "cron", "recurring", "periodic", "timer"
  - User mentions 定时任务, 定期执行, 周期性, 计划任务
  - Running something at a specific time repeatedly
  - Automating a task to run on schedule
---

# Task Scheduler

You can create and manage scheduled tasks that run automatically on a cron schedule.

## CLI Reference

All commands use `clawbench task` and output JSON to stdout. Run them via the Bash tool.

### Create a Task

```bash
clawbench task create --name "TASK_NAME" --cron "CRON_EXPR" --agent AGENT_ID --prompt "PROMPT" --repeat MODE [--max-runs N]
```

- `--name` (required): Brief task name
- `--cron` (required): 5-field cron expression (min hour day month weekday)
- `--agent` (required): Agent ID from {{AVAILABLE_AGENTS}}
- `--prompt` (required): Full prompt text for each execution
- `--repeat` (default: unlimited): `once` | `limited` | `unlimited`
- `--max-runs` (required when --repeat=limited): Maximum number of executions

**Success response:** `{"ok":true,"task":{"id":"task-xxx","name":"...","status":"active",...}}`
**Error response:** `{"ok":false,"error":"..."}`

On success, extract `task.id` from the response and include a tag in your message:
```
<scheduled-task id="task-xxx" />
```

### Update a Task

```bash
clawbench task update TASK_ID [--name NAME] [--cron EXPR] [--agent AGENT_ID] [--prompt PROMPT] [--repeat MODE] [--max-runs N]
```

Only fields you want to change need to be provided. Updating a completed task reactivates it.

### Delete a Task

```bash
clawbench task delete TASK_ID
```

Soft-deletes the task. It will no longer appear in task lists.

### Pause a Task

```bash
clawbench task pause TASK_ID
```

Pauses the cron schedule. The task will not execute until resumed.

### Resume a Task

```bash
clawbench task resume TASK_ID
```

Resumes a paused task. The cron schedule is reactivated.

### Trigger a Task (manual run)

```bash
clawbench task trigger TASK_ID
```

Runs the task immediately, regardless of the cron schedule. Does not affect the schedule.

## Cron Expression Quick Reference

| Expression | Meaning |
|-----------|---------|
| `0 9 * * *` | Every day at 9:00 |
| `*/30 * * * *` | Every 30 minutes |
| `0 9 * * 1-5` | Weekdays at 9:00 |
| `0 0 1 * *` | First day of each month |
| `30 8 * * 1` | Every Monday at 8:30 |

For "run once at a specific time": get current time via `date '+%M %H %d %m'`, compute the cron fields, use `--repeat once`.
