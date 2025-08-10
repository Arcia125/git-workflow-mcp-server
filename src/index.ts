#!/usr/bin/env node

/**
 * Git Workflow Automation MCP Server
 *
 * Provides automated Git workflow tools for committing, creating PRs, and merging.
 * Handles GitHub authentication issues and provides reliable workflow automation.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { simpleGit, SimpleGit } from 'simple-git';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

/**
 * Interface for Git workflow results
 */
interface WorkflowResult {
  success: boolean;
  message: string;
  details?: any;
  error?: string;
}

/**
 * Create an MCP server with Git workflow automation capabilities
 */
const server = new Server(
  {
    name: "git-workflow-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Escape PowerShell string literals to prevent command injection
 */
function escapePowerShellString(str: string): string {
  return str
    .replace(/'/g, "''")  // Escape single quotes
    .replace(/`/g, "``")  // Escape backticks
    .replace(/\$/g, "`$") // Escape dollar signs
    .replace(/"/g, '""'); // Escape double quotes
}

/**
 * Execute GitHub CLI command with environment variable clearing
 * Uses temporary files for complex text to avoid PowerShell parsing issues
 */
async function executeGitHubCommand(
  baseCommand: string,
  options?: {
    title?: string;
    body?: string;
    cwd?: string;
  }
): Promise<{ stdout: string; stderr: string }> {
  let tempBodyFile: string | null = null;

  try {
    let finalCommand = baseCommand;

    // If we have a body, write it to a temporary file to avoid PowerShell parsing issues
    if (options?.body) {
      tempBodyFile = join(tmpdir(), `gh-pr-body-${Date.now()}.txt`);
      writeFileSync(tempBodyFile, options.body, 'utf8');

      // Replace --body with --body-file, handling both quoted and unquoted body content
      finalCommand = finalCommand.replace(/--body\s+"[^"]*"/, `--body-file "${tempBodyFile}"`);
      finalCommand = finalCommand.replace(/--body\s+[^\s]+/, `--body-file "${tempBodyFile}"`);
    }

    // If we have a title, properly escape it for PowerShell
    if (options?.title) {
      const escapedTitle = escapePowerShellString(options.title);
      finalCommand = finalCommand.replace(/--title\s+"([^"]*)"/, `--title '${escapedTitle}'`);
    }

    // Build the PowerShell command with proper token clearing
    const powerShellCommand = `powershell -Command "Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue; ${finalCommand}"`;

    const result = await execAsync(powerShellCommand, {
      cwd: options?.cwd || process.cwd(),
      maxBuffer: 1024 * 1024 // 1MB buffer
    });

    return result;
  } catch (error: any) {
    throw new Error(`Command failed: ${error.message}\nStdout: ${error.stdout}\nStderr: ${error.stderr}`);
  } finally {
    // Clean up temporary file
    if (tempBodyFile) {
      try {
        unlinkSync(tempBodyFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Execute simple command with environment variable clearing for GitHub CLI
 */
async function executeWithClearedTokens(command: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const powerShellCommand = `powershell -Command "Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue; Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue; ${command}"`;

  try {
    const result = await execAsync(powerShellCommand, {
      cwd: cwd || process.cwd(),
      maxBuffer: 1024 * 1024 // 1MB buffer
    });
    return result;
  } catch (error: any) {
    throw new Error(`Command failed: ${error.message}\nStdout: ${error.stdout}\nStderr: ${error.stderr}`);
  }
}

/**
 * Get Git instance for the specified directory
 */
function getGit(workingDir?: string): SimpleGit {
  return simpleGit(workingDir || process.cwd());
}

/**
 * Commit and push changes
 */
async function commitAndPush(
  files: string[],
  commitMessage: string,
  branch?: string,
  workingDir?: string,
  dryRun: boolean = false
): Promise<WorkflowResult> {
  try {
    const git = getGit(workingDir);

    if (dryRun) {
      return {
        success: true,
        message: "Dry run: Would commit and push changes",
        details: {
          files,
          commitMessage,
          branch,
          workingDir
        }
      };
    }

    // Check if we're in a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        success: false,
        message: "Failed to commit and push",
        error: "Not a Git repository"
      };
    }

    // Get current status
    const status = await git.status();

    // Create branch if specified and doesn't exist
    if (branch) {
      try {
        await git.checkoutBranch(branch, 'HEAD');
      } catch (error) {
        // Branch might already exist, try to switch to it
        try {
          await git.checkout(branch);
        } catch (switchError) {
          return {
            success: false,
            message: "Failed to commit and push",
            error: `Failed to create or switch to branch ${branch}: ${switchError}`
          };
        }
      }
    }

    // Add specified files
    if (files.length > 0) {
      await git.add(files);
    } else {
      // Add all modified files if no specific files provided
      await git.add('.');
    }

    // Commit changes
    const commitResult = await git.commit(commitMessage);

    // Push changes
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    await git.push('origin', currentBranch);

    return {
      success: true,
      message: "Successfully committed and pushed changes",
      details: {
        commit: commitResult.commit,
        branch: currentBranch,
        files: commitResult.summary.changes,
        insertions: commitResult.summary.insertions,
        deletions: commitResult.summary.deletions
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: "Failed to commit and push",
      error: error.message
    };
  }
}

/**
 * Create a pull request using GitHub CLI
 */
async function createPullRequest(
  title: string,
  body: string,
  baseBranch: string = 'main',
  headBranch?: string,
  workingDir?: string,
  dryRun: boolean = false
): Promise<WorkflowResult> {
  try {
    if (dryRun) {
      return {
        success: true,
        message: "Dry run: Would create pull request",
        details: {
          title,
          body,
          baseBranch,
          headBranch
        }
      };
    }

    // Get current branch if not specified
    if (!headBranch) {
      const git = getGit(workingDir);
      headBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    }

    // Create PR using GitHub CLI with cleared tokens and proper escaping
    const command = `gh pr create --title "${title}" --body "${body}" --base ${baseBranch} --head ${headBranch}`;
    const result = await executeGitHubCommand(command, {
      title,
      body,
      cwd: workingDir
    });

    // Extract PR URL from output
    const prUrl = result.stdout.trim();

    return {
      success: true,
      message: "Successfully created pull request",
      details: {
        url: prUrl,
        title,
        baseBranch,
        headBranch
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: "Failed to create pull request",
      error: `Failed to create pull request: ${error.message}`
    };
  }
}

/**
 * Merge a pull request
 */
async function mergePullRequest(
  prNumber: string,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge',
  deleteBranch: boolean = true,
  workingDir?: string,
  dryRun: boolean = false
): Promise<WorkflowResult> {
  try {
    if (dryRun) {
      return {
        success: true,
        message: "Dry run: Would merge pull request",
        details: {
          prNumber,
          mergeMethod,
          deleteBranch
        }
      };
    }

    // Merge PR using GitHub CLI with cleared tokens
    const mergeFlag = mergeMethod === 'squash' ? '--squash' : mergeMethod === 'rebase' ? '--rebase' : '--merge';
    const deleteFlag = deleteBranch ? '--delete-branch' : '';
    const command = `gh pr merge ${prNumber} ${mergeFlag} ${deleteFlag}`.trim();

    const result = await executeWithClearedTokens(command, workingDir);

    return {
      success: true,
      message: "Successfully merged pull request",
      details: {
        prNumber,
        mergeMethod,
        output: result.stdout
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: "Failed to merge pull request",
      error: `Failed to merge pull request: ${error.message}`
    };
  }
}

/**
 * Complete Git workflow: commit, push, create PR, and optionally merge
 */
async function completeGitWorkflow(
  files: string[],
  commitMessage: string,
  prTitle: string,
  prBody: string,
  branch?: string,
  baseBranch: string = 'main',
  autoMerge: boolean = false,
  workingDir?: string,
  dryRun: boolean = false
): Promise<WorkflowResult> {
  try {
    if (dryRun) {
      return {
        success: true,
        message: "Dry run: Would execute complete Git workflow",
        details: {
          files,
          commitMessage,
          prTitle,
          prBody,
          branch,
          baseBranch,
          autoMerge
        }
      };
    }

    // Step 1: Commit and push
    const commitResult = await commitAndPush(files, commitMessage, branch, workingDir);
    if (!commitResult.success) {
      return commitResult;
    }

    // Step 2: Create pull request
    const prResult = await createPullRequest(prTitle, prBody, baseBranch, branch, workingDir);
    if (!prResult.success) {
      return prResult;
    }

    let mergeResult = null;
    if (autoMerge && prResult.details?.url) {
      // Extract PR number from URL
      const prMatch = prResult.details.url.match(/\/pull\/(\d+)$/);
      if (prMatch) {
        const prNumber = prMatch[1];
        mergeResult = await mergePullRequest(prNumber, 'merge', true, workingDir);
      }
    }

    return {
      success: true,
      message: "Successfully completed Git workflow",
      details: {
        commit: commitResult.details,
        pullRequest: prResult.details,
        merge: mergeResult?.details
      }
    };
  } catch (error: any) {
    return {
      success: false,
      message: "Git workflow failed",
      error: `Git workflow failed: ${error.message}`
    };
  }
}

/**
 * Handler that lists available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "git_commit_and_push",
        description: "Commit staged changes and push to remote repository",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Array of file paths to commit (empty for all changes)"
            },
            commitMessage: {
              type: "string",
              description: "Commit message (use conventional commit format)"
            },
            branch: {
              type: "string",
              description: "Branch name to create/switch to (optional)"
            },
            workingDir: {
              type: "string",
              description: "Working directory path (defaults to current directory)"
            },
            dryRun: {
              type: "boolean",
              description: "Preview changes without executing",
              default: false
            }
          },
          required: ["commitMessage"]
        }
      },
      {
        name: "create_pull_request",
        description: "Create a GitHub pull request with proper authentication handling",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Pull request title"
            },
            body: {
              type: "string",
              description: "Pull request description"
            },
            baseBranch: {
              type: "string",
              description: "Base branch (target)",
              default: "main"
            },
            headBranch: {
              type: "string",
              description: "Head branch (source, defaults to current branch)"
            },
            workingDir: {
              type: "string",
              description: "Working directory path"
            },
            dryRun: {
              type: "boolean",
              description: "Preview without executing",
              default: false
            }
          },
          required: ["title", "body"]
        }
      },
      {
        name: "merge_pull_request",
        description: "Merge a GitHub pull request",
        inputSchema: {
          type: "object",
          properties: {
            prNumber: {
              type: "string",
              description: "Pull request number"
            },
            mergeMethod: {
              type: "string",
              enum: ["merge", "squash", "rebase"],
              description: "Merge method",
              default: "merge"
            },
            deleteBranch: {
              type: "boolean",
              description: "Delete branch after merge",
              default: true
            },
            workingDir: {
              type: "string",
              description: "Working directory path"
            },
            dryRun: {
              type: "boolean",
              description: "Preview without executing",
              default: false
            }
          },
          required: ["prNumber"]
        }
      },
      {
        name: "complete_git_workflow",
        description: "Execute complete Git workflow: commit, push, create PR, and optionally merge",
        inputSchema: {
          type: "object",
          properties: {
            files: {
              type: "array",
              items: { type: "string" },
              description: "Files to commit"
            },
            commitMessage: {
              type: "string",
              description: "Commit message (conventional format)"
            },
            prTitle: {
              type: "string",
              description: "Pull request title"
            },
            prBody: {
              type: "string",
              description: "Pull request description"
            },
            branch: {
              type: "string",
              description: "Feature branch name"
            },
            baseBranch: {
              type: "string",
              description: "Base branch",
              default: "main"
            },
            autoMerge: {
              type: "boolean",
              description: "Automatically merge PR after creation",
              default: false
            },
            workingDir: {
              type: "string",
              description: "Working directory path"
            },
            dryRun: {
              type: "boolean",
              description: "Preview without executing",
              default: false
            }
          },
          required: ["commitMessage", "prTitle", "prBody"]
        }
      }
    ]
  };
});

/**
 * Handler for tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: WorkflowResult;

    switch (name) {
      case "git_commit_and_push":
        result = await commitAndPush(
          (args?.files as string[]) || [],
          args?.commitMessage as string,
          args?.branch as string,
          args?.workingDir as string,
          (args?.dryRun as boolean) || false
        );
        break;

      case "create_pull_request":
        result = await createPullRequest(
          args?.title as string,
          args?.body as string,
          (args?.baseBranch as string) || 'main',
          args?.headBranch as string,
          args?.workingDir as string,
          (args?.dryRun as boolean) || false
        );
        break;

      case "merge_pull_request":
        result = await mergePullRequest(
          args?.prNumber as string,
          (args?.mergeMethod as 'merge' | 'squash' | 'rebase') || 'merge',
          (args?.deleteBranch as boolean) ?? true,
          args?.workingDir as string,
          (args?.dryRun as boolean) || false
        );
        break;

      case "complete_git_workflow":
        result = await completeGitWorkflow(
          (args?.files as string[]) || [],
          args?.commitMessage as string,
          args?.prTitle as string,
          args?.prBody as string,
          args?.branch as string,
          (args?.baseBranch as string) || 'main',
          (args?.autoMerge as boolean) || false,
          args?.workingDir as string,
          (args?.dryRun as boolean) || false
        );
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message
          }, null, 2)
        }
      ],
      isError: true
    };
  }
});

/**
 * Start the server using stdio transport
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Git Workflow MCP Server error:", error);
  process.exit(1);
});
