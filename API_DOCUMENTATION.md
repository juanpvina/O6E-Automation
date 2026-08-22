# OpenCode Orchestrator REST API Documentation

This API enables OpenCode (and other automation systems) to programmatically manage agentic workflows, projects, and trigger executions locally and offline.

The orchestrator backend runs locally by default at: `http://127.0.0.1:3001`

---

## 1. Workflows API

### List Workflows
* **URL**: `/api/workflows`
* **Method**: `GET`
* **Description**: Retrieve all registered workflows.
* **Response (JSON)**: Array of Workflow objects.

### Get Workflow by ID
* **URL**: `/api/workflows/:id`
* **Method**: `GET`
* **Description**: Retrieve details of a specific workflow.
* **Response (JSON)**: Workflow object.

### Create Workflow
* **URL**: `/api/workflows`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`
* **Request Body (JSON)**:
```json
{
  "id": "my-cool-workflow",
  "name": "Auto Diagnose and PR Fix",
  "projectId": "optional-default-project-id",
  "version": 1,
  "isActive": true,
  "steps": [
    {
      "id": "webhook_trigger",
      "type": "trigger",
      "config": {
        "triggerType": "webhook"
      },
      "nextStepIds": ["diagnose_agent"]
    },
    {
      "id": "diagnose_agent",
      "type": "agent",
      "config": {
        "projectId": "project-slug",
        "agent": "diagnoser",
        "model": "gemini-3-flash-preview",
        "prompt": "Find and fix bugs in localPath: {{context.repositoryPath}}"
      },
      "nextStepIds": []
    }
  ]
}
```
* **Response (JSON)**:
```json
{
  "message": "Workflow created successfully.",
  "newWebhookTokens": {
    "webhook_trigger": "BearerTokenStringHere"
  }
}
```

### Update Workflow
* **URL**: `/api/workflows/:id`
* **Method**: `PUT`
* **Headers**: `Content-Type: application/json`
* **Request Body (JSON)**: Same fields as Create Workflow (except ID).
* **Response (JSON)**: Success message and new tokens if rotated.

### Delete Workflow
* **URL**: `/api/workflows/:id`
* **Method**: `DELETE`
* **Description**: Delete a workflow and unregister any associated cron triggers or webhook connections.

---

## 2. Projects API

### List Projects
* **URL**: `/api/projects`
* **Method**: `GET`
* **Description**: Fetch all registered project workspaces.

### Create Project
* **URL**: `/api/projects`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`
* **Request Body (JSON)**:
```json
{
  "id": "my-project-slug",
  "name": "My Node Website",
  "localPath": "C:\\Users\\juanp\\Projects\\my-web-app",
  "gitRemoteUrl": "git@github.com:user/my-web-app.git",
  "baseBranch": "main",
  "allowedCommands": ["npm test", "npm run build"],
  "policy": {
    "maxExecutionTimeSeconds": 600,
    "concurrencyMode": "serialize",
    "requireApprovalForDestructiveActions": true
  }
}
```

### Delete Project
* **URL**: `/api/projects/:id`
* **Method**: `DELETE`
* **Description**: Delete a project. Workflows referencing this project will fall back to isolated temporary workspaces.

---

## 3. Executions (Runs) API

### List Executions
* **URL**: `/api/executions`
* **Method**: `GET`
* **Description**: Retrieve execution history, sorted from newest to oldest.

### Trigger Execution Manually
* **URL**: `/api/executions/trigger`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`
* **Request Body (JSON)**:
```json
{
  "workflowId": "my-cool-workflow",
  "projectId": "optional-override-project-id",
  "payload": {
    "message": "Manual run parameter details"
  }
}
```
* **Response (JSON)**:
```json
{
  "executionId": "uuid-v4-execution-id"
}
```

### Approve / Reject Pending Gate
* **URL**: `/api/executions/:id/approvals/:approvalId/action`
* **Method**: `POST`
* **Headers**: `Content-Type: application/json`
* **Request Body (JSON)**:
```json
{
  "approved": true
}
```

---

## 4. How OpenCode uses this API to modify flows

OpenCode can interact with this API using standard tools like `curl` or language-native HTTP requests. For instance, to dynamically insert a new step or rotate a token:

### Example: Dynamic Workflow Generation (bash/curl)
```bash
curl -X POST http://127.0.0.1:3001/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "id": "dynamic-opencode-runner",
    "name": "OpenCode Triggered Flow",
    "version": 1,
    "isActive": true,
    "steps": [
      {
        "id": "trigger_node",
        "type": "trigger",
        "config": { "triggerType": "webhook" },
        "nextStepIds": ["agent_task"]
      },
      {
        "id": "agent_task",
        "type": "agent",
        "config": {
          "prompt": "Optimize this: {{message}}",
          "agent": "engineer",
          "model": "gemini-3-flash-preview"
        },
        "nextStepIds": []
      }
    ]
  }'
```
