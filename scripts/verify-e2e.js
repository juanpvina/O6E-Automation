const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');

const PORT = 3001;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTest() {
  console.log('--- Starting E2E Verification Script ---');

  // 1. Create temporary repository folder
  const tempRepoPath = path.join(__dirname, '../temp-repo');
  await fs.mkdir(tempRepoPath, { recursive: true });

  console.log(`Created temporary repo at: ${tempRepoPath}`);

  // 2. Start the backend server
  console.log('Spawning backend server...');
  const server = spawn('node', ['packages/backend/dist/index.js'], {
    env: { ...process.env, PORT: PORT.toString() },
    shell: true
  });

  // Log server output to verify execution
  server.stdout.on('data', (data) => {
    console.log(`[Server STDOUT] ${data.toString().trim()}`);
  });
  server.stderr.on('data', (data) => {
    console.error(`[Server STDERR] ${data.toString().trim()}`);
  });

  // Wait 3 seconds for server boot
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    // 3. Create Project
    console.log('Creating project...');
    const projectRes = await fetch(`${BASE_URL}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test-project',
        name: 'E2E Testing Project',
        localPath: tempRepoPath,
        gitRemoteUrl: '',
        baseBranch: 'master',
        allowedCommands: ['echo'],
        policy: {
          maxExecutionTimeSeconds: 60,
          concurrencyMode: 'serialize',
          requireApprovalForDestructiveActions: true
        }
      })
    });
    if (!projectRes.ok) throw new Error(`Failed to create project: ${await projectRes.text()}`);
    console.log('Project created.');

    // 5. Create Workflow with approval gate
    console.log('Creating workflow graph...');
    const workflowRes = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'test-workflow',
        name: 'E2E Validation Workflow',
        projectId: 'test-project',
        version: 1,
        isActive: true,
        steps: [
          {
            id: 'trigger_step',
            type: 'trigger',
            config: {},
            nextStepIds: ['approval_step']
          },
          {
            id: 'approval_step',
            type: 'approval',
            config: { description: 'Verify credentials and approve run' },
            nextStepIds: ['test_step']
          },
          {
            id: 'test_step',
            type: 'shell_test',
            config: { command: 'echo "VerifySuccess"' },
            nextStepIds: ['output_step']
          },
          {
            id: 'output_step',
            type: 'output',
            config: {
              outputType: 'file',
              filePath: 'output-verification.txt',
              data: 'E2E Verification Success: {{triggerPayload.message}}'
            },
            nextStepIds: []
          }
        ]
      })
    });
    if (!workflowRes.ok) throw new Error(`Failed to create workflow: ${await workflowRes.text()}`);
    console.log('Workflow graph registered.');

    // 6. Create Connection Webhook
    console.log('Creating webhook connection...');
    const connRes = await fetch(`${BASE_URL}/api/connections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Webhook Trigger',
        projectId: 'test-project',
        workflowId: 'test-workflow'
      })
    });
    if (!connRes.ok) throw new Error(`Failed to create connection: ${await connRes.text()}`);
    const conn = await connRes.json();
    console.log(`Webhook created with ID: ${conn.id}. Token: ${conn.rawToken}`);

    // 7. Trigger Webhook
    console.log('Sending webhook POST payload...');
    const triggerRes = await fetch(`${BASE_URL}/webhooks/${conn.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${conn.rawToken}`
      },
      body: JSON.stringify({
        message: 'Antigravity works!'
      })
    });
    if (!triggerRes.ok) throw new Error(`Webhook trigger failed: ${await triggerRes.text()}`);
    const triggerData = await triggerRes.json();
    const executionId = triggerData.executionId;
    console.log(`Webhook accepted. Execution ID: ${executionId}`);

    // 8. Poll until execution hits approval gate
    console.log('Polling execution status (waiting for approval gate)...');
    let attempts = 0;
    let execution = null;
    while (attempts < 20) {
      const execRes = await fetch(`${BASE_URL}/api/executions/${executionId}`);
      execution = await execRes.json();
      console.log(`Current execution status: ${execution.status}`);
      if (execution.status === 'waiting_approval') {
        break;
      }
      if (execution.status === 'failed') {
        throw new Error(`Execution failed unexpectedly: ${execution.errorMessage}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (execution.status !== 'waiting_approval') {
      throw new Error('Timeout: execution did not hit the approval gate.');
    }
    console.log('Approval gate successfully reached!');

    // 9. Approve the execution
    console.log('Approving action to resume execution...');
    const approveRes = await fetch(`${BASE_URL}/api/executions/${executionId}/approvals/approval_step/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true })
    });
    if (!approveRes.ok) throw new Error(`Failed to approve execution: ${await approveRes.text()}`);
    console.log('Action approved.');

    // 10. Poll until succeeded
    console.log('Polling execution status (waiting for completion)...');
    attempts = 0;
    while (attempts < 20) {
      const execRes = await fetch(`${BASE_URL}/api/executions/${executionId}`);
      execution = await execRes.json();
      console.log(`Current execution status: ${execution.status}`);
      if (execution.status === 'succeeded') {
        break;
      }
      if (execution.status === 'failed') {
        throw new Error(`Execution failed unexpectedly during resume: ${execution.errorMessage}`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (execution.status !== 'succeeded') {
      throw new Error('Timeout: execution did not finish successfully.');
    }
    console.log('Workflow completed successfully!');

    // 11. Verify output file exists and has correct data
    const outputFilePath = path.join(tempRepoPath, 'output-verification.txt');
    const content = await fs.readFile(outputFilePath, 'utf8');
    console.log(`Output file contents: "${content}"`);
    if (content !== 'E2E Verification Success: Antigravity works!') {
      throw new Error(`Validation mismatch. Got: "${content}"`);
    }

    console.log('\n=============================================');
    console.log('E2E VERIFICATION COMPLETED SUCCESSFULLY! 🎉');
    console.log('=============================================\n');
  } catch (err) {
    console.error('E2E Verification FAILED! ❌', err);
    process.exitCode = 1;
  } finally {
    // 12. Cleanup processes and directories
    console.log('Cleaning up server and files...');
    server.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      await fs.rm(tempRepoPath, { recursive: true, force: true });
      await fs.rm(path.join(__dirname, '../db'), { recursive: true, force: true });
      await fs.rm(path.join(__dirname, '../.secret_key'), { force: true });
      console.log('Cleanup completed.');
    } catch (e) {
      console.warn('Failed to delete temp files:', e.message);
    }
    process.exit();
  }
}

runTest();
