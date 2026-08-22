# Automation Team Guide

This guide describes the workflow contracts that are currently implemented in OpenCode Orchestrator. It is written for teams authoring workflows in the visual editor or by importing the same JSON shape.

## Guarantees

- A workflow is a directed graph. Each node is a `WorkflowStep`; `nextStepIds` points to the next node IDs.
- An execution stores the `workflowVersion` that it used. Editing a workflow does not rewrite that execution's stored version.
- The local file store writes documents as readable JSON and uses a temporary file before replacing the target file.
- JSON values are retained with their JSON types: strings, numbers, booleans, arrays, objects, and `null` round-trip unchanged.
- Executions remain in the `executions` collection until an explicit delete. There is currently no automatic age-, count-, or size-based retention job.
- Before each executed node, a debug snapshot stores the prior `stepOutputs`, variables, artifacts, and branch state when those values exist. The snapshot for a node does not contain that node's own output.
- Secrets must not be put in workflow configuration, prompts, payloads, or logs. Use the secret store and the supported credential configuration instead.
- Commands and generated files are constrained to the configured project path. The workflow must not be used as a way to operate on another directory.
- A workflow can create a branch, commit, push, or pull request when configured to do so, but it never merges automatically.

## JSON Authoring Shape

The minimum useful document has an ID, version, activation flag, and a list of connected steps:

```json
{
  "id": "daily-health-check",
  "name": "Daily health check",
  "version": 1,
  "isActive": true,
  "steps": [
    {
      "id": "trigger",
      "type": "trigger",
      "config": {},
      "nextStepIds": ["summarize"]
    },
    {
      "id": "summarize",
      "type": "transform",
      "config": { "template": "Health: {{triggerPayload.status}}" },
      "nextStepIds": []
    }
  ],
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

Authoring rules:

- Every step ID must be unique.
- Every ID in `nextStepIds` must refer to another step.
- Use one trigger node as the entry point for a simple workflow.
- Use an empty `nextStepIds` array for a terminal node.
- Keep configuration values as JSON. Arrays and nested objects are supported by storage and by the code node context.
- Increment `version` when publishing a meaningful workflow revision.

## Practical Workflow: Validate and Report

This flow receives a webhook payload, normalizes it, runs a safe project-local test, and writes a report file.

```text
trigger -> normalizer -> shell_test -> transform -> output
```

Suggested configuration:

```json
[
  {
    "id": "trigger",
    "type": "trigger",
    "config": {},
    "nextStepIds": ["normalize"]
  },
  {
    "id": "normalize",
    "type": "normalizer",
    "config": {
      "mapping": {
        "buildId": "context.triggerPayload.buildId",
        "status": "context.triggerPayload.status"
      }
    },
    "nextStepIds": ["test"]
  },
  {
    "id": "test",
    "type": "shell_test",
    "config": { "command": "npm test" },
    "nextStepIds": ["report"]
  },
  {
    "id": "report",
    "type": "transform",
    "config": { "template": "Build {{triggerPayload.buildId}} completed" },
    "nextStepIds": ["write-report"]
  },
  {
    "id": "write-report",
    "type": "output",
    "config": {
      "outputType": "file",
      "filePath": "artifacts/health-report.txt",
      "data": "Build {{triggerPayload.buildId}} completed"
    },
    "nextStepIds": []
  }
]
```

Only use commands allowed by the project policy. A normalizer's `mapping` values are expressions evaluated against the execution context; test them with a representative payload before enabling the connection.

## Practical Workflow: JSON With Python

The `code` node can run Python when `python3` or `python` is available on the worker PATH. The node receives a JSON file with this shape:

```json
{
  "triggerPayload": {},
  "stepOutputs": {},
  "variables": {}
}
```

User code can assign `result` and update `context['variables']`:

```python
payload = context['triggerPayload']
items = payload.get('items', [])

context['variables']['itemCount'] = len(items)
result = {
    'accepted': True,
    'itemCount': len(items),
    'firstItem': items[0] if items else None
}
```

The result is emitted as JSON and becomes the code node's `stepOutputs` result. Python execution is not guaranteed on every installation: missing Python fails the node with an interpreter error. Keep stdout available for the runner's protocol; arbitrary output before the protocol marker can make the result invalid.

## Practical Workflow: Branch, Approval, and Notifications

Use `condition` to choose a path, `approval` before a destructive or externally visible action, and `discord_notify` or `google_sheets` for downstream reporting. Set `onTrue` and `onFalse` to the IDs of the two branch nodes:

```text
trigger -> condition
             | true  -> approval -> discord_notify
             | false -> google_sheets (simulated if credentials are absent)
```

Important configuration examples:

```json
{
  "id": "route",
  "type": "condition",
  "config": {
    "expression": "context.triggerPayload.release === true",
    "onTrue": "approve-release",
    "onFalse": "record"
  },
  "nextStepIds": ["approve-release", "record"]
}
```

```json
{
  "id": "approve-release",
  "type": "approval",
  "config": {
    "description": "Approve release {{triggerPayload.version}}"
  },
  "nextStepIds": ["notify"]
}
```

```json
{
  "id": "notify",
  "type": "discord_notify",
  "config": {
    "webhookUrl": "https://discord.com/api/webhooks/REDACTED",
    "message": "Release {{triggerPayload.version}} approved"
  },
  "nextStepIds": []
}
```

```json
{
  "id": "record",
  "type": "google_sheets",
  "config": {
    "spreadsheetId": "spreadsheet-id",
    "range": "Runs!A:C",
    "operation": "append",
    "values": [["{{triggerPayload.version}}", "{{triggerPayload.status}}"]]
  },
  "nextStepIds": []
}
```

Google Sheets runs in simulated mode when its credential is not available. Treat that as a development aid, not proof that production credentials work. Do not commit webhook URLs, access tokens, or service-account contents to workflow JSON.

## Debugging Runs

Use the executions view to select a node and inspect its status, timing, logs, and output. The useful debugging sequence is:

1. Confirm the execution status and the first failed node.
2. Inspect that node's input snapshot, not only its final output.
3. Compare `stepOutputs` from the snapshot with the payload sent to the node.
4. Correct the workflow configuration and start a new run, or use the available rewind action where the UI exposes it.

Snapshots represent the context immediately before a node runs. A snapshot for `report` includes earlier outputs but not `report`'s output. Snapshots are execution data and can contain user payloads, so protect access to the local dashboard and remove old executions explicitly when they are no longer needed.

## Retention And Cleanup

There is no automatic retention policy today. The local JSON files under `db/executions/` are historical records and survive process restarts. Teams should periodically review their size and delete old records through the supported store/API operation or their operational cleanup procedure. Do not delete files while an execution is running.

Retention is not archival storage: execution logs, payloads, snapshots, and outputs may contain sensitive business data. Apply the same filesystem protections as the project repository and avoid placing secrets in any of those fields.

## What Is Not Guaranteed

- Python availability, Python package availability, and external network services are environment-dependent.
- The simulated Google Sheets path does not verify Google permissions or production API behavior.
- A successful workflow run does not imply that an external notification or pull request was reviewed.
- Workflow edits are not retroactive. Existing executions continue to describe the workflow version with which they started.
- Automatic merge, automatic retention cleanup, and secret recovery from workflow JSON are not supported behaviors.
