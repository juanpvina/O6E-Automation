import { describe, it, expect, vi, beforeAll } from 'vitest';
import { CLIOpenCodeRunner, RemoteOpenCodeRunner } from './runner';
import { GcpSecretManagerSecretStore } from './secrets';
import { GitLabProvider, BitbucketProvider } from './git';
import type { AgentMetrics } from '@opencode/shared';

const mockSecretManagerClient = {
  accessSecretVersion: vi.fn(),
  getSecret: vi.fn(),
  createSecret: vi.fn(),
  addSecretVersion: vi.fn(),
  deleteSecret: vi.fn(),
};

vi.mock('@google-cloud/secret-manager', () => {
  return {
    SecretManagerServiceClient: function() {
      return mockSecretManagerClient;
    },
  };
});

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

interface ParseMetricsFn {
  parseMetrics(output: string, fallbackModel: string | undefined, durationMs: number): AgentMetrics;
}

function makeParser(): ParseMetricsFn {
  return new CLIOpenCodeRunner() as unknown as ParseMetricsFn;
}

describe('CLIOpenCodeRunner.parseMetrics', () => {
  const parser = makeParser();

  it('devuelve solo durationMs con salida vacía', () => {
    expect(parser.parseMetrics('', undefined, 500)).toEqual({ durationMs: 500 });
  });

  it('siempre incluye durationMs', () => {
    const m = parser.parseMetrics('model: gpt-4o', undefined, 42);
    expect(m.durationMs).toBe(42);
  });

  it('detecta el modelo desde el stdout (case-insensitive)', () => {
    expect(parser.parseMetrics('Running Model: gpt-4o', undefined, 1).model).toBe('gpt-4o');
    expect(parser.parseMetrics('modelo: llama3.1', undefined, 1).model).toBe('llama3.1');
  });

  it('usa el modelo fallback cuando no aparece en el output', () => {
    const m = parser.parseMetrics('some generic text', 'claude-3-7-sonnet-latest', 1);
    expect(m.model).toBe('claude-3-7-sonnet-latest');
  });

  it('no sobreescribe el modelo detectado con el fallback', () => {
    const m = parser.parseMetrics('Model: gemini-2.5-pro', 'gpt-4o-mini', 1);
    expect(m.model).toBe('gemini-2.5-pro');
  });

  it('parsea tokens emparejados en la misma línea', () => {
    const m = parser.parseMetrics('input: 1234, output: 456', undefined, 1);
    expect(m.inputTokens).toBe(1234);
    expect(m.outputTokens).toBe(456);
    expect(m.totalTokens).toBe(1690);
  });

  it('parsea tokens individuales "tokens in/out"', () => {
    const m = parser.parseMetrics('tokens in: 100\ntokens out: 50', undefined, 1);
    expect(m.inputTokens).toBe(100);
    expect(m.outputTokens).toBe(50);
    expect(m.totalTokens).toBe(150);
  });

  it('parsea "input_tokens" y "output_tokens"', () => {
    const m = parser.parseMetrics('input_tokens: 1000 | output_tokens: 2000', undefined, 1);
    expect(m.inputTokens).toBe(1000);
    expect(m.outputTokens).toBe(2000);
    expect(m.totalTokens).toBe(3000);
  });

  it('cae al total genérico "N tokens" cuando no hay conteos separados', () => {
    const m = parser.parseMetrics('Total: 5000 tokens', undefined, 1);
    expect(m.totalTokens).toBe(5000);
    expect(m.inputTokens).toBeUndefined();
    expect(m.outputTokens).toBeUndefined();
  });

  it('parsea el costo "cost/cost/costo"', () => {
    expect(parser.parseMetrics('cost: $0.25', undefined, 1).estimatedCostUsd).toBe(0.25);
    expect(parser.parseMetrics('Costo: $1.5', undefined, 1).estimatedCostUsd).toBe(1.5);
    expect(parser.parseMetrics('Coste: 12.34', undefined, 1).estimatedCostUsd).toBe(12.34);
  });

  it('parsea un costo genérico "$X.XX"', () => {
    expect(parser.parseMetrics('Total: $7.89', undefined, 1).estimatedCostUsd).toBe(7.89);
  });

  it('combina todas las métricas en una salida realista', () => {
    const output = [
      'Running agent opencode:',
      'Model: gpt-4o',
      'tokens in: 1234',
      'tokens out: 567',
      'cost: $0.12'
    ].join('\n');
    const m = parser.parseMetrics(output, undefined, 9000);
    expect(m).toEqual({
      model: 'gpt-4o',
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
      estimatedCostUsd: 0.12,
      durationMs: 9000
    });
  });
});

describe('GcpSecretManagerSecretStore', () => {
  let store: GcpSecretManagerSecretStore;

  beforeAll(() => {
    process.env.GCP_PROJECT_ID = 'test-gcp-project';
    store = new GcpSecretManagerSecretStore();
  });

  it('getSecret returns secret value if exists', async () => {
    mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
      payload: {
        data: Buffer.from('my-secret-val', 'utf8')
      }
    }]);
    const val = await store.getSecret('proj1', 'key1');
    expect(val).toBe('my-secret-val');
    expect(mockSecretManagerClient.accessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/test-gcp-project/secrets/opencode-proj1-key1/versions/latest'
    });
  });

  it('getSecret returns null if not found', async () => {
    const notFoundError = new Error('Secret not found');
    (notFoundError as any).code = 5;
    mockSecretManagerClient.accessSecretVersion.mockRejectedValueOnce(notFoundError);
    const val = await store.getSecret('proj1', 'key1');
    expect(val).toBeNull();
  });

  it('setSecret creates and adds a version', async () => {
    mockSecretManagerClient.getSecret.mockResolvedValueOnce({});
    mockSecretManagerClient.addSecretVersion.mockResolvedValueOnce({});

    await store.setSecret('proj1', 'key1', 'new-val');
    expect(mockSecretManagerClient.addSecretVersion).toHaveBeenCalledWith({
      parent: 'projects/test-gcp-project/secrets/opencode-proj1-key1',
      payload: {
        data: Buffer.from('new-val', 'utf8')
      }
    });
  });

  it('setSecret creates secret first if not exists', async () => {
    const notFoundError = new Error('Secret not found');
    (notFoundError as any).code = 5;
    mockSecretManagerClient.getSecret.mockRejectedValueOnce(notFoundError);
    mockSecretManagerClient.createSecret.mockResolvedValueOnce({});
    mockSecretManagerClient.addSecretVersion.mockResolvedValueOnce({});

    await store.setSecret('proj1', 'key1', 'new-val');
    expect(mockSecretManagerClient.createSecret).toHaveBeenCalled();
    expect(mockSecretManagerClient.addSecretVersion).toHaveBeenCalled();
  });

  it('deleteSecret deletes secret resource', async () => {
    mockSecretManagerClient.deleteSecret.mockResolvedValueOnce({});
    await store.deleteSecret('proj1', 'key1');
    expect(mockSecretManagerClient.deleteSecret).toHaveBeenCalledWith({
      name: 'projects/test-gcp-project/secrets/opencode-proj1-key1'
    });
  });
});

describe('GitLabProvider', () => {
  let git: GitLabProvider;

  beforeAll(() => {
    git = new GitLabProvider();
  });

  it('createPullRequest calls GitLab API', async () => {
    const runCommandSpy = vi.spyOn(git as any, 'runCommand');
    runCommandSpy.mockResolvedValueOnce({
      stdout: 'https://gitlab.com/test-owner/test-repo.git',
      stderr: '',
      code: 0
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        web_url: 'https://gitlab.com/test-owner/test-repo/-/merge_requests/1',
        iid: 42
      })
    });

    const result = await git.createPullRequest({
      localPath: '/tmp/repo',
      title: 'PR Title',
      body: 'PR Body',
      headBranch: 'feature',
      baseBranch: 'main',
      githubToken: 'gitlab-token'
    });

    expect(result).toEqual({
      prUrl: 'https://gitlab.com/test-owner/test-repo/-/merge_requests/1',
      prNumber: 42
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://gitlab.com/api/v4/projects/test-owner%2Ftest-repo/merge_requests',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'PRIVATE-TOKEN': 'gitlab-token'
        })
      })
    );
  });
});

describe('BitbucketProvider', () => {
  let git: BitbucketProvider;

  beforeAll(() => {
    git = new BitbucketProvider();
  });

  it('createPullRequest calls Bitbucket API', async () => {
    const runCommandSpy = vi.spyOn(git as any, 'runCommand');
    runCommandSpy.mockResolvedValueOnce({
      stdout: 'https://bitbucket.org/test-owner/test-repo.git',
      stderr: '',
      code: 0
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        links: {
          html: { href: 'https://bitbucket.org/test-owner/test-repo/pull-requests/1' }
        },
        id: 101
      })
    });

    const result = await git.createPullRequest({
      localPath: '/tmp/repo',
      title: 'PR Title',
      body: 'PR Body',
      headBranch: 'feature',
      baseBranch: 'main',
      githubToken: 'bitbucket-token'
    });

    expect(result).toEqual({
      prUrl: 'https://bitbucket.org/test-owner/test-repo/pull-requests/1',
      prNumber: 101
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.bitbucket.org/2.0/repositories/test-owner/test-repo/pullrequests',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer bitbucket-token'
        })
      })
    );
  });
});

describe('RemoteOpenCodeRunner', () => {
  let runner: RemoteOpenCodeRunner;

  beforeAll(() => {
    process.env.REMOTE_RUNNER_URL = 'https://remote-runner.example.com';
    process.env.REMOTE_RUNNER_AUTH_TOKEN = 'test-auth-token';
    runner = new RemoteOpenCodeRunner();
  });

  it('run sends post request and triggers onLog', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({
        success: true,
        output: 'Agent finished task',
        exitCode: 0,
        logs: ['Starting task', 'Task complete'],
        metrics: { totalTokens: 1000 }
      }))
    });

    const logsReceived: string[] = [];
    const result = await runner.run({
      message: 'Hello Agent',
      workdir: '/tmp/work',
      onLog: (line) => logsReceived.push(line)
    });

    expect(result).toEqual({
      success: true,
      output: 'Agent finished task',
      exitCode: 0,
      metrics: { totalTokens: 1000 }
    });
    expect(logsReceived).toEqual(['Starting task', 'Task complete']);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://remote-runner.example.com',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-auth-token',
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('rejects a malformed response schema', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
      text: () => Promise.resolve(JSON.stringify({ success: 'yes', output: '' }))
    });

    await expect(runner.run({
      message: 'Hello Agent',
      workdir: '/tmp/work',
      onLog: () => undefined
    })).rejects.toThrow('invalid response schema');
  });
});
