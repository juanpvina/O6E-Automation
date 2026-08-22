import { spawn } from 'child_process';
import { IGitProvider } from '@opencode/shared';

export class LocalGitProvider implements IGitProvider {
  protected runCommand(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        cwd,
        shell: false,
        env: { ...process.env, ...env }
      });

      const maxOutputBytes = Number(process.env.GIT_MAX_OUTPUT_BYTES) > 0
        ? Number(process.env.GIT_MAX_OUTPUT_BYTES)
        : 4 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      const append = (current: string, chunk: string): string => {
        const remaining = maxOutputBytes - Buffer.byteLength(current, 'utf8');
        if (remaining <= 0) return current;
        return current + Buffer.from(chunk, 'utf8').subarray(0, remaining).toString('utf8');
      };

      proc.stdout.on('data', (data) => {
        const before = stdout;
        stdout = append(stdout, data.toString());
        stdoutTruncated ||= Buffer.byteLength(before, 'utf8') + data.length > maxOutputBytes;
      });

      proc.stderr.on('data', (data) => {
        const before = stderr;
        stderr = append(stderr, data.toString());
        stderrTruncated ||= Buffer.byteLength(before, 'utf8') + data.length > maxOutputBytes;
      });

      proc.on('error', (err) => {
        resolve({ stdout: stdout.trim(), stderr: stderrTruncated ? `${stderr.trim()} [truncated]` : (err.message || String(err)), code: -1 });
      });

      proc.on('close', (code) => {
        resolve({
          stdout: stdoutTruncated ? `${stdout.trim()} [truncated]` : stdout.trim(),
          stderr: stderrTruncated ? `${stderr.trim()} [truncated]` : stderr.trim(),
          code: code ?? -1
        });
      });
    });
  }

  async cloneOrFetch(localPath: string, remoteUrl: string): Promise<void> {
    if (!remoteUrl || typeof remoteUrl !== 'string' || remoteUrl.includes('mock-repo')) {
      return;
    }

    // Check if the directory is already a git repo
    const statusResult = await this.runCommand('git', ['status'], localPath);
    if (statusResult.code !== 0) {
      // If it doesn't exist, we can't clone over an existing non-empty directory. 
      // Instead, initialize it or fetch.
      await this.runCommand('git', ['init'], localPath);
      await this.runCommand('git', ['remote', 'add', 'origin', remoteUrl], localPath);
    }
    
    // Fetch origin
    const fetchResult = await this.runCommand('git', ['fetch', 'origin'], localPath);
    if (fetchResult.code !== 0) {
      console.warn(`Git fetch failed (ignoring for local development/mocks): ${fetchResult.stderr}`);
    }
  }

  async createBranch(localPath: string, branchName: string): Promise<void> {
    // Checkout a new branch from origin
    const checkoutResult = await this.runCommand('git', ['checkout', '-b', branchName], localPath);
    if (checkoutResult.code !== 0) {
      // Try checking out if it already exists
      const checkoutExist = await this.runCommand('git', ['checkout', branchName], localPath);
      if (checkoutExist.code !== 0) {
        throw new Error(`Git checkout/branch creation failed: ${checkoutResult.stderr || checkoutExist.stderr}`);
      }
    }
  }

  async commitChanges(localPath: string, message: string): Promise<void> {
    // Stage all changes
    const addResult = await this.runCommand('git', ['add', '.'], localPath);
    if (addResult.code !== 0) {
      throw new Error(`Git add failed: ${addResult.stderr}`);
    }

    // Commit changes
    const commitResult = await this.runCommand('git', ['commit', '-m', message], localPath);
    // Exit code 1 on commit means "nothing to commit, working tree clean", which is acceptable
    if (commitResult.code !== 0 && !commitResult.stdout.includes('nothing to commit')) {
      throw new Error(`Git commit failed: ${commitResult.stderr}`);
    }
  }

  async push(localPath: string, branchName: string, githubToken: string, allowFailure: boolean = false): Promise<void> {
    const pushArgs = ['push', 'origin', branchName];
    const env = this.credentialEnv(githubToken, 'x-access-token');
    
    const pushResult = await this.runCommand('git', pushArgs, localPath, env);
    if (pushResult.code !== 0) {
      if (allowFailure) {
        console.warn(`Git push failed (ignoring for local development/mocks): ${pushResult.stderr}`);
      } else {
        throw new Error(`Git push failed: ${pushResult.stderr}`);
      }
    }
  }

  protected credentialEnv(token: string, username: string): Record<string, string> {
    if (!token) return {};
    return {
      GITHUB_TOKEN: token,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: `!f() { echo username=${username}; echo password="$GITHUB_TOKEN"; }; f`
    };
  }

  async createPullRequest(params: {
    localPath: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    githubToken: string;
    allowMock?: boolean;
  }): Promise<{ prUrl: string; prNumber: number }> {
    const env = this.credentialEnv(params.githubToken, 'x-access-token');

    // Use GitHub CLI 'gh' to create a Pull Request
    const prResult = await this.runCommand(
      'gh',
      [
        'pr',
        'create',
        '--title',
        params.title,
        '--body',
        params.body,
        '--head',
        params.headBranch,
        '--base',
        params.baseBranch
      ],
      params.localPath,
      env
    );

    if (prResult.code !== 0) {
      if (params.allowMock === true) {
        // Fallback: If 'gh' is not installed or authenticated, mock the PR URL
        console.warn('GitHub CLI (gh) PR creation failed, generating local PR mock:', prResult.stderr);
        
        let owner = 'mock-owner';
        let repo = 'mock-repo';
        
        const getRemote = await this.runCommand('git', ['remote', 'get-url', 'origin'], params.localPath);
        if (getRemote.code === 0) {
          const remoteUrl = getRemote.stdout.trim();
          const githubMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^.]+)(?:\.git)?/);
          if (githubMatch) {
            owner = githubMatch[1];
            repo = githubMatch[2].replace(/\.git$/, '');
          }
        }

        return {
          prUrl: `https://github.com/${owner}/${repo}/pull/mock-${Math.floor(Math.random() * 1000)}`,
          prNumber: Math.floor(Math.random() * 100) + 1
        };
      }

      throw new Error(`GitHub CLI (gh) PR creation failed: ${prResult.stderr}`);
    }

    // Extract the PR URL from stdout (usually outputs the URL directly on success)
    const prUrl = prResult.stdout.trim();
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    return {
      prUrl,
      prNumber
    };
  }
}

export class GitLabProvider extends LocalGitProvider {
  async push(localPath: string, branchName: string, githubToken: string): Promise<void> {
    const env = this.credentialEnv(githubToken, 'oauth2');
    const pushResult = await this.runCommand('git', ['push', 'origin', branchName], localPath, env);
    if (pushResult.code !== 0) {
      throw new Error(`GitLab push failed: ${pushResult.stderr}`);
    }
  }

  async createPullRequest(params: {
    localPath: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    githubToken: string;
  }): Promise<{ prUrl: string; prNumber: number }> {
    const getRemote = await this.runCommand('git', ['remote', 'get-url', 'origin'], params.localPath);
    if (getRemote.code !== 0) {
      throw new Error(`Failed to get git remote url: ${getRemote.stderr}`);
    }
    const remoteUrl = getRemote.stdout.trim();
    const match = remoteUrl.match(/gitlab\.com[:/](.+)/);
    if (!match) {
      throw new Error(`Could not parse GitLab repository path from remote URL: ${remoteUrl}`);
    }
    let repoPath = match[1];
    if (repoPath.endsWith('.git')) {
      repoPath = repoPath.slice(0, -4);
    }
    const projectId = encodeURIComponent(repoPath);

    const apiUrl = `https://gitlab.com/api/v4/projects/${projectId}/merge_requests`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': params.githubToken
      },
      body: JSON.stringify({
        source_branch: params.headBranch,
        target_branch: params.baseBranch,
        title: params.title,
        description: params.body
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GitLab API error: ${response.status} - ${errText}`);
    }

    const mr = await response.json() as any;
    return {
      prUrl: mr.web_url || '',
      prNumber: mr.iid || 0
    };
  }
}

export class BitbucketProvider extends LocalGitProvider {
  async push(localPath: string, branchName: string, githubToken: string): Promise<void> {
    const env = this.credentialEnv(githubToken, 'x-token-auth');
    const pushResult = await this.runCommand('git', ['push', 'origin', branchName], localPath, env);
    if (pushResult.code !== 0) {
      throw new Error(`Bitbucket push failed: ${pushResult.stderr}`);
    }
  }

  async createPullRequest(params: {
    localPath: string;
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
    githubToken: string;
  }): Promise<{ prUrl: string; prNumber: number }> {
    const getRemote = await this.runCommand('git', ['remote', 'get-url', 'origin'], params.localPath);
    if (getRemote.code !== 0) {
      throw new Error(`Failed to get git remote url: ${getRemote.stderr}`);
    }
    const remoteUrl = getRemote.stdout.trim();
    const match = remoteUrl.match(/bitbucket\.org[:/]([^/]+)\/([^.]+)(?:\.git)?/);
    if (!match) {
      throw new Error(`Could not parse Bitbucket repository path from remote URL: ${remoteUrl}`);
    }
    const owner = match[1];
    let repo = match[2];
    if (repo.endsWith('.git')) {
      repo = repo.slice(0, -4);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (params.githubToken.includes(':')) {
      const encoded = Buffer.from(params.githubToken).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
    } else {
      headers['Authorization'] = `Bearer ${params.githubToken}`;
    }

    const apiUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/pullrequests`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: params.title,
        description: params.body,
        source: {
          branch: {
            name: params.headBranch
          }
        },
        destination: {
          branch: {
            name: params.baseBranch
          }
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Bitbucket API error: ${response.status} - ${errText}`);
    }

    const pr = await response.json() as any;
    return {
      prUrl: pr.links?.html?.href || '',
      prNumber: pr.id || 0
    };
  }
}
