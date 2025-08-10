# Git Workflow Automation MCP Server

A Model Context Protocol (MCP) server that provides automated Git workflow tools for committing, creating pull requests, and merging with proper GitHub authentication handling.

## Features

- **Automated Git Operations**: Commit, push, create PRs, and merge in one command
- **GitHub Authentication Handling**: Automatically clears problematic environment tokens
- **Dry Run Support**: Test operations before executing them
- **Conventional Commits**: Supports proper commit message formatting
- **Branch Management**: Automatic branch creation and switching
- **Error Handling**: Comprehensive error reporting and rollback capabilities

## Available Tools

### 1. `git_commit_and_push`
Commits staged changes and pushes to remote repository.

**Parameters:**
- `files` (array, optional): File paths to commit (empty for all changes)
- `commitMessage` (string, required): Commit message (use conventional format)
- `branch` (string, optional): Branch name to create/switch to
- `workingDir` (string, optional): Working directory path
- `dryRun` (boolean, optional): Preview without executing

**Example:**
```javascript
use_mcp_tool("git-workflow", "git_commit_and_push", {
  "files": ["src/app.ts", "README.md"],
  "commitMessage": "feat: add new authentication system",
  "branch": "feature/auth-system",
  "dryRun": true
})
```

### 2. `create_pull_request`
Creates a GitHub pull request with proper authentication handling.

**Parameters:**
- `title` (string, required): Pull request title
- `body` (string, required): Pull request description
- `baseBranch` (string, optional): Base branch (default: "main")
- `headBranch` (string, optional): Head branch (defaults to current)
- `workingDir` (string, optional): Working directory path
- `dryRun` (boolean, optional): Preview without executing

**Example:**
```javascript
use_mcp_tool("git-workflow", "create_pull_request", {
  "title": "Feature: User Authentication System",
  "body": "Implements comprehensive user authentication with JWT tokens and OAuth2 support",
  "baseBranch": "main",
  "headBranch": "feature/auth-system"
})
```

### 3. `merge_pull_request`
Merges a GitHub pull request.

**Parameters:**
- `prNumber` (string, required): Pull request number
- `mergeMethod` (string, optional): "merge", "squash", or "rebase" (default: "merge")
- `deleteBranch` (boolean, optional): Delete branch after merge (default: true)
- `workingDir` (string, optional): Working directory path
- `dryRun` (boolean, optional): Preview without executing

**Example:**
```javascript
use_mcp_tool("git-workflow", "merge_pull_request", {
  "prNumber": "42",
  "mergeMethod": "squash",
  "deleteBranch": true
})
```

### 4. `complete_git_workflow`
Executes the complete Git workflow: commit, push, create PR, and optionally merge.

**Parameters:**
- `files` (array, optional): Files to commit
- `commitMessage` (string, required): Commit message (conventional format)
- `prTitle` (string, required): Pull request title
- `prBody` (string, required): Pull request description
- `branch` (string, optional): Feature branch name
- `baseBranch` (string, optional): Base branch (default: "main")
- `autoMerge` (boolean, optional): Automatically merge PR (default: false)
- `workingDir` (string, optional): Working directory path
- `dryRun` (boolean, optional): Preview without executing

**Example:**
```javascript
use_mcp_tool("git-workflow", "complete_git_workflow", {
  "files": ["src/**/*.ts", "docs/**/*.md"],
  "commitMessage": "feat(auth): implement OAuth2 authentication",
  "prTitle": "Feature: OAuth2 Authentication System",
  "prBody": "Adds comprehensive OAuth2 authentication with Google and GitHub providers",
  "branch": "feature/oauth2-auth",
  "autoMerge": false,
  "dryRun": true
})
```

## Installation

### Quick Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/Arcia125/git-workflow-mcp-server.git
   cd git-workflow-mcp-server
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Server**
   ```bash
   npm run build
   ```

4. **Add to MCP Configuration**

   Add the server to your MCP client settings file:

   ```json
   {
     "mcpServers": {
       "git-workflow": {
         "command": "node",
         "args": ["/path/to/git-workflow-mcp-server/build/index.js"],
         "disabled": false,
         "alwaysAllow": [],
         "disabledTools": []
       }
     }
   }
   ```

### Alternative: NPM Global Install (Coming Soon)

Future versions will support global npm installation:
```bash
npm install -g git-workflow-mcp-server
```

### Configuration Paths

**Common MCP Settings Locations:**
- **Roo-Code**: `%APPDATA%/Code - Insiders/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json`
- **Claude Desktop**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Other MCP Clients**: Check your client's documentation for settings location

### Verify Installation

Test the installation with a dry run:
```javascript
use_mcp_tool("git-workflow", "git_commit_and_push", {
  "files": ["README.md"],
  "commitMessage": "test: verify MCP server installation",
  "dryRun": true
})
```

## Prerequisites

- Node.js installed
- Git configured with remote repository
- GitHub CLI (`gh`) installed and authenticated
- Proper GitHub repository permissions

## Authentication

The server automatically handles GitHub authentication issues by:

1. Clearing problematic environment tokens (`GITHUB_TOKEN`, `GH_TOKEN`)
2. Using PowerShell commands for reliable token management
3. Relying on GitHub CLI keyring authentication
4. Providing detailed error messages for authentication failures

## Best Practices

### 1. Always Use Dry Run First
```javascript
// Test the operation first
use_mcp_tool("git-workflow", "complete_git_workflow", {
  "commitMessage": "feat: add new feature",
  "prTitle": "New Feature",
  "prBody": "Description",
  "dryRun": true
})

// Then execute after confirmation
use_mcp_tool("git-workflow", "complete_git_workflow", {
  "commitMessage": "feat: add new feature",
  "prTitle": "New Feature",
  "prBody": "Description",
  "dryRun": false
})
```

### 2. Use Conventional Commits
```javascript
// Good commit messages:
"feat(auth): add OAuth2 integration"
"fix(ui): resolve button alignment issue"
"docs(api): update endpoint documentation"
"refactor(utils): simplify date formatting"
```

### 3. Meaningful PR Titles and Descriptions
```javascript
{
  "prTitle": "Feature: OAuth2 Authentication System",
  "prBody": "## Changes\n- Implements OAuth2 with Google/GitHub\n- Adds JWT token management\n- Updates user authentication flow\n\n## Testing\n- All auth tests pass\n- Manual testing completed"
}
```

## Error Handling

The server provides comprehensive error handling:

- **Git Repository Errors**: Validates repository state
- **Authentication Failures**: Handles GitHub CLI auth issues
- **Network Issues**: Provides clear error messages
- **Branch Conflicts**: Manages branch creation/switching
- **Merge Conflicts**: Reports merge issues clearly

## Dependencies

- `@modelcontextprotocol/sdk`: MCP server framework
- `simple-git`: Git operations
- `axios`: HTTP requests (if needed)
- `zod`: Schema validation

## Development

To modify the server:

1. Edit `src/index.ts`
2. Run `npm run build`
3. Restart your MCP client

## Support

For issues or questions:
- Check GitHub CLI authentication: `gh auth status`
- Verify repository permissions
- Review error messages for specific guidance
- Test with dry run mode first

## Version

Version 0.1.0 - Initial release with core Git workflow automation features.
