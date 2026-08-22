import { spawn } from 'child_process';
import { AgentMetrics, IOpenCodeRunner } from '@opencode/shared';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_REMOTE_TIMEOUT_MS = 120_000;
const MAX_REMOTE_RESPONSE_BYTES = 10 * 1024 * 1024;

function positiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function appendLimited(current: string, chunk: string, maxBytes: number): { value: string; truncated: boolean } {
  const currentBytes = Buffer.byteLength(current, 'utf8');
  if (currentBytes >= maxBytes) return { value: current, truncated: true };
  const remaining = maxBytes - currentBytes;
  const chunkBuffer = Buffer.from(chunk, 'utf8');
  if (chunkBuffer.byteLength <= remaining) return { value: current + chunk, truncated: false };
  return {
    value: current + chunkBuffer.subarray(0, remaining).toString('utf8'),
    truncated: true
  };
}

async function readResponseTextLimited(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Remote runner response exceeds the maximum allowed size');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error('Remote runner response exceeds the maximum allowed size');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('Remote runner response exceeds the maximum allowed size');
  }
  return text;
}

export class CLIOpenCodeRunner implements IOpenCodeRunner {
  async run(params: {
    message: string;
    model?: string;
    agent?: string;
    workdir: string;
    onLog: (log: string) => void;
    signal?: AbortSignal;
  }): Promise<{ success: boolean; output: string; exitCode: number; metrics?: AgentMetrics }> {
    return new Promise((resolve) => {
      const startMs = Date.now();
      const args: string[] = ['run'];
      
      if (params.agent) {
        args.push('--agent', params.agent);
      }
      if (params.model) {
        args.push('--model', params.model);
      }
      
      // Add the user message
      args.push(params.message);

      // On Windows, opencode can be a powershell script.
      // Setting shell: true helps Node find it globally in PATH.
      const proc = spawn('opencode', args, {
        cwd: params.workdir,
        shell: true,
        env: { ...process.env }
      });

      let fullOutput = '';
      const maxOutputBytes = positiveEnvNumber('OPENCODE_MAX_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES);
      let outputTruncated = false;
      let settled = false;

      const recordOutput = (chunk: string) => {
        const result = appendLimited(fullOutput, chunk, maxOutputBytes);
        fullOutput = result.value;
        if (result.truncated && !outputTruncated) {
          params.onLog('[Output truncated: size limit reached]\n');
        } else if (!result.truncated) {
          params.onLog(chunk);
        }
        outputTruncated ||= result.truncated;
      };

      const finish = (result: { success: boolean; output: string; exitCode: number }) => {
        if (settled) return;
        settled = true;
        params.signal?.removeEventListener('abort', onAbort);
        const metrics = this.parseMetrics(result.output, params.model, Date.now() - startMs);
        resolve({ ...result, metrics });
      };

      const onAbort = () => {
        try {
          if (process.platform === 'win32') {
            if (proc.pid != null) {
              spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F']);
            } else {
              proc.kill('SIGKILL');
            }
          } else {
            try {
              if (proc.pid != null) {
                process.kill(-proc.pid, 'SIGKILL');
              }
            } catch {
              proc.kill('SIGKILL');
            }
          }
        } catch (err) {
          const killErr = `Error killing opencode process on abort: ${(err as Error).message}\n`;
          recordOutput(killErr);
        }
        finish({
          success: false,
          output: fullOutput + '\n[Timeout] Process killed.',
          exitCode: -1
        });
      };

      if (params.signal?.aborted) {
        onAbort();
      } else {
        params.signal?.addEventListener('abort', onAbort);
      }

      proc.stdout.on('data', (data) => {
        recordOutput(data.toString());
      });

      proc.stderr.on('data', (data) => {
        recordOutput(data.toString());
      });

      proc.on('close', (code) => {
        finish({
          success: code === 0,
          output: outputTruncated ? `${fullOutput}\n[Output truncated: size limit reached]` : fullOutput,
          exitCode: code ?? -1
        });
      });

      proc.on('error', (err) => {
        const errMessage = `Error spawning opencode process: ${err.message}\n`;
        recordOutput(errMessage);
        finish({
          success: false,
          output: fullOutput,
          exitCode: -1
        });
      });
    });
  }

  /**
   * Tolera parseo de métricas del stdout/stderr de `opencode run`. Nunca lanza
   * errores: si no encuentra nada relevante devuelve solo `durationMs`.
   */
  private parseMetrics(output: string, fallbackModel: string | undefined, durationMs: number): AgentMetrics {
    const metrics: AgentMetrics = { durationMs };
    const text = output || '';

    // Modelo: `model:`, `Model:`, `modelo:` (case-insensitive)
    const modelMatch = text.match(/(?:model|modelo):\s*(\S+)/i);
    if (modelMatch) {
      metrics.model = modelMatch[1];
    } else if (fallbackModel) {
      metrics.model = fallbackModel;
    }

    // Tokens pareados en la misma línea: "input: 1234, output: 456"
    const pairMatch = text.match(/input\D*?(\d+)\D*?output\D*?(\d+)/i);
    if (pairMatch) {
      metrics.inputTokens = Number(pairMatch[1]);
      metrics.outputTokens = Number(pairMatch[2]);
    } else {
      const inMatch = text.match(/tokens?\s*in:\s*(\d+)/i)
        || text.match(/input_?tokens?\s*[:=]?\s*(\d+)/i);
      if (inMatch) metrics.inputTokens = Number(inMatch[1]);
      const outMatch = text.match(/tokens?\s*out:\s*(\d+)/i)
        || text.match(/output_?tokens?\s*[:=]?\s*(\d+)/i);
      if (outMatch) metrics.outputTokens = Number(outMatch[1]);
    }

    if (metrics.inputTokens !== undefined && metrics.outputTokens !== undefined) {
      metrics.totalTokens = metrics.inputTokens + metrics.outputTokens;
    } else {
      // Fallback genérico: "1234 tokens"
      const tokensMatch = text.match(/(\d+)\s*tokens/i);
      if (tokensMatch) metrics.totalTokens = Number(tokensMatch[1]);
    }

    // Costo: "cost/coste/costo: $X.XX" o cualquier "$X.XX"
    const costMatch = text.match(/(?:cost|coste|costo):\s*\$?\s*([\d.]+)/i)
      || text.match(/\$\s*([\d.]+)/);
    if (costMatch) metrics.estimatedCostUsd = Number(costMatch[1]);

    return metrics;
  }
}

export class RemoteOpenCodeRunner implements IOpenCodeRunner {
  async run(params: {
    message: string;
    model?: string;
    agent?: string;
    workdir: string;
    onLog: (log: string) => void;
    signal?: AbortSignal;
  }): Promise<{ success: boolean; output: string; exitCode: number; metrics?: AgentMetrics }> {
    const remoteUrl = process.env.REMOTE_RUNNER_URL;
    if (!remoteUrl) {
      throw new Error('REMOTE_RUNNER_URL environment variable is required for RemoteOpenCodeRunner');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authToken = process.env.REMOTE_RUNNER_AUTH_TOKEN;
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const requestBody = {
      message: params.message,
      model: params.model,
      agent: params.agent,
      workdir: params.workdir
    };

    const timeoutMs = positiveEnvNumber('REMOTE_RUNNER_TIMEOUT_MS', DEFAULT_REMOTE_TIMEOUT_MS);
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const onAbort = () => timeoutController.abort();
    params.signal?.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    let responseText: string;
    try {
      response = await fetch(remoteUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal
      });
       responseText = await readResponseTextLimited(response, MAX_REMOTE_RESPONSE_BYTES);
    } finally {
      clearTimeout(timeout);
      params.signal?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) {
      const errText = responseText.slice(0, 2048);
      throw new Error(`Remote runner failed: ${response.status} - ${errText}`);
    }

    const contentLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REMOTE_RESPONSE_BYTES) {
      throw new Error('Remote runner response exceeds the maximum allowed size');
    }
    let json: any;
    try {
      json = JSON.parse(responseText);
    } catch {
      throw new Error('Remote runner returned invalid JSON');
    }
    if (!json || typeof json !== 'object' || typeof json.success !== 'boolean' ||
      typeof json.output !== 'string' ||
      (json.exitCode !== undefined && typeof json.exitCode !== 'number') ||
      (json.logs !== undefined && !Array.isArray(json.logs))) {
      throw new Error('Remote runner returned an invalid response schema');
    }

    const maxOutputBytes = positiveEnvNumber('OPENCODE_MAX_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES);
    const output = appendLimited('', json.output, maxOutputBytes);

    let logBytes = 0;
    if (json.logs) {
      for (const logLine of json.logs) {
        let formatted: string;
        if (typeof logLine === 'string') {
          formatted = logLine;
        } else if (logLine && typeof logLine === 'object' && typeof logLine.message === 'string') {
          formatted = logLine.message;
        } else {
          continue;
        }
        if (logBytes >= maxOutputBytes) break;
        const limited = appendLimited('', formatted, maxOutputBytes - logBytes);
        logBytes += Buffer.byteLength(limited.value, 'utf8');
        params.onLog(limited.value);
      }
    }

    return {
      success: !!json.success,
      output: output.truncated ? `${output.value}\n[Output truncated: size limit reached]` : output.value,
      exitCode: typeof json.exitCode === 'number' ? json.exitCode : (json.success ? 0 : -1),
      metrics: json.metrics
    };
  }
}
