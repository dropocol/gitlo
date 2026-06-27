<div align="left">

[![gitlo](https://raw.githubusercontent.com/dropocol/gitlo/main/banner.png)](https://github.com/dropocol/gitlo)

[![npm version](https://img.shields.io/npm/v/gitlo.svg)](https://www.npmjs.com/package/gitlo)
[![npm downloads](https://img.shields.io/npm/dm/gitlo.svg)](https://www.npmjs.com/package/gitlo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/gitlo)](https://nodejs.org)

# gitlo

**Backup your GitHub repos. Never lose your code.**

Never lose your code to account deletions, suspensions, or unexpected issues.

</div>

---

## ✨ Features

- 🔐 **Secure** - Token stored locally in `~/.gitlo/config.json`
- 🍴 **Fork Support** - Optionally backup forked repositories
- 🔒 **Private Repos** - Backs up private repositories with proper token
- ⏰ **Auto-Schedule** - Built-in cron scheduler for automatic backups
- 📊 **Progress Tracking** - Visual progress with spinners and stats
- 🚀 **Fast** - Only updates changed repos with `--update` flag
- 📝 **Logging** - Full logs of backup operations
- 🎯 **Dry Run** - Preview what will be backed up without downloading

## 🤔 Why?

GitHub accounts can be deleted, suspended, or compromised. This tool creates a local backup of all your repositories so you always have a copy of your work.

## 📦 Installation

### Quick Install (npm)

```bash
npm install -g gitlo
```

### Requirements

- **Node.js** >= 18.0.0
- **Git** installed on your system

### Alternative: Install from Source

```bash
# Clone and build
git clone https://github.com/dropocol/gitlo.git
cd gitlo
npm install
npm run build

# Link globally
npm link --global
```

## Getting a GitHub Token

gitlo supports two types of GitHub personal access tokens:

### Option 1: Classic Token (Recommended)

1. Go to [https://github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select these scopes:
  - `repo` - Full control of private repositories
  - `read:user` - Read user profile data
4. Generate and copy the token

### Option 2: Fine-Grained Token

1. Go to [https://github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token" → "Fine-grained token"
3. Configure permissions:
  - **Repository permissions**: 
    - Contents: **Read and write** (required for cloning)
    - Metadata: **Read-only** (required for repository access)
  - **Account permissions**:
    - User profile: **Read-only** (optional, for user info)
4. Select the repositories to access (or "All repositories")
5. Generate and copy the token

## 🚀 Quick Start

### 1. Get a GitHub Token

1. Go to [GitHub Settings → Tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select scopes: ☑️ `repo` and ☑️ `read:user`
4. Generate and copy the token

### 2. Configure gitlo (One-time setup)

```bash
# Save your token
gitlo config set token ghp_xxxxxxxxxxxx

# Optional: Set backup directory
gitlo config set output-dir ~/backups/github
```

### 3. Run Backup

```bash
# Backup all your repos
gitlo

# Include forks too
gitlo --include-forks

# Setup automatic daily backups
gitlo schedule setup --frequency daily
```

## 🎬 Interactive Mode

Don't want to memorize flags? Just run `gitlo` with **no arguments** and you'll get a guided menu:

```bash
gitlo
```

```
🗄️  gitlo - GitHub Backup Tool

What would you like to do?
  1. 🔄  Run a backup now
  2. ⚙️   Configure settings (token / output directory / branch strategy)
  3. 📅  Schedule automatic backups
  4. 👀  View current configuration
  5. ⬆️   Update gitlo
  6. 🚪  Exit
> 
```

The menu walks you through every option — token setup, output directory, clone method, forks/private filtering, dry-run, and scheduling — with sensible defaults and inline validation. It's the easiest way to use gitlo if you're not sure which flags you need.

**Tip:** Any flag or subcommand skips the menu and behaves exactly as before. For example `gitlo --include-forks`, `gitlo config list`, and `gitlo schedule setup` all run directly without prompting.

## Commands

### `gitlo`

Run the backup with configured settings.

### `gitlo config`

Manage gitlo configuration settings (token, output directory, branch strategy).

### `gitlo schedule`

Schedule automatic backups with cron (built-in scheduler).

### `gitlo update`

Update gitlo to the latest version from npm. Runs `npm install -g gitlo@latest` for you.

## 🔄 Updating gitlo

gitlo automatically checks for new versions in the background (at most once per day) and shows a banner when an update is available. You'll never be left on an outdated version without knowing it.

```bash
# Update to the latest version
gitlo update

# Or manually
npm install -g gitlo@latest
```

You can also update from the interactive menu — run `gitlo` (no args) and choose **"⬆️ Update gitlo"**.

> The update check is non-blocking, cached daily, and only displays in an interactive terminal (never in CI/scripts). It queries the public npm registry directly — no new dependencies.

## All Commands & Options

### Main Backup Command

```bash
gitlo [options]
```

**Options:**

- `-t, --token <token>` - GitHub personal access token
- `-o, --output-dir <dir>` - Output directory for backups
- `-m, --method <method>` - Clone method: https or ssh (default: https)
- `--include-private` - Include private repositories (default: true)
- `--exclude-private` - Exclude private repositories
- `--include-forks` - Include forked repositories (default: false)
- `--dry-run` - Show what would be backed up without cloning
- `--update` - Update existing repositories with git pull
- `-b, --branch-strategy <strategy>` - When updating: `default` (sync default branch only) or `all` (sync every branch). (default: all)
- `-v, --verbose` - Show detailed progress and filtering information
- `-V, --version` - Display the installed gitlo version
- `-h, --help` - Display help

### 🌿 Branch Strategy

When a repo already exists locally and you run with `--update`, gitlo fetches all branches' history either way (nothing is lost). The **branch strategy** controls how much of that is synced into the working tree:

- **`all`** (default) — Checks out and fast-forwards **every** branch so each one's files are up to date on disk. Most complete; recommended for backups since the whole point is to never lose access to your code.
- **`default`** — Fast-forwards only the repo's default branch (e.g. `main`). Faster; useful if you have repos with many branches and only care about the main one.

```bash
# Update existing repos — syncs ALL branches by default
gitlo --update

# Sync only the default branch (faster)
gitlo --update --branch-strategy default

# Set it permanently via config
gitlo config set branch-strategy all
```

> **First-time clones** always fetch every branch and the full history, regardless of strategy. The strategy only affects how existing repos are *updated*.

### ⚠️ Important: Forks Are Excluded by Default

By default, `gitlo` **does not backup forked repositories**. If you have forks you want to backup, use `--include-forks`:

```bash
# Backup everything including forks
gitlo --include-forks

# Backup only your own repos (no forks) - this is the default
gitlo
```

### Config Commands

#### `gitlo config set`

Set a configuration value.

```bash
gitlo config set token <github-token>
gitlo config set output-dir <path>
gitlo config set branch-strategy <default|all>
```

**Examples:**

```bash
# Set your GitHub token
gitlo config set token ghp_xxxxxxxxxxxx

# Set default backup directory
gitlo config set output-dir ~/backups/github-repos

# Use ~ for home directory (automatically expanded)
gitlo config set output-dir ~/Documents/GitHub-Backups

# Set branch strategy for updating existing repos
gitlo config set branch-strategy all
```

#### `gitlo config get`

View a specific configuration value.

```bash
gitlo config get token
gitlo config get output-dir
gitlo config get branch-strategy
```

**Output:**

- Token is masked for security (shows: `ghp_****xxxx`)
- Output-dir shows the full path
- Branch-strategy shows `default` or `all`

#### `gitlo config list`

List all configuration values.

```bash
gitlo config list
```

**Output:**

```
📋 gitlo Configuration

  token: ghp_****xxxx
  output-dir: /Users/username/backups/github-repos
  branch-strategy: all

Config file: /Users/username/.gitlo/config.json
```

#### `gitlo config remove`

Remove a configuration value.

```bash
gitlo config remove token
gitlo config remove output-dir
gitlo config remove branch-strategy   # resets to default
```

### Schedule Commands

#### `gitlo schedule setup`

Schedule automatic backups with cron.

```bash
# Weekly on Sunday at 2 AM (default, updates existing repos)
gitlo schedule setup

# Daily at 3 AM
gitlo schedule setup --frequency daily --time 03:00

# Weekly on Monday at 2 AM
gitlo schedule setup --frequency weekly --day 1

# Monthly on the 1st at 2 AM
gitlo schedule setup --frequency monthly

# Full backup (clone all repos, don't just update)
gitlo schedule setup --full
```

#### `gitlo schedule list`

View scheduled backup jobs.

```bash
gitlo schedule list
```

#### `gitlo schedule remove`

Remove automatic backup schedule.

```bash
gitlo schedule remove
```

## Configuration Priority

### Token Priority (first found wins):

1. CLI argument: `gitlo -t TOKEN`
2. Environment variable: `GITHUB_TOKEN`
3. Config file: `gitlo config set token TOKEN`

### Output Directory Priority:

1. CLI argument: `gitlo -o ~/my-backups`
2. Config file: `gitlo config set output-dir ~/backups`
3. Default: your GitHub username as folder name

## Usage Examples

### One-Time Setup (Recommended)

```bash
# Step 1: Save your token
gitlo config set token ghp_your_token_here

# Step 2: Set default backup location (optional)
gitlo config set output-dir ~/backups/github

# Step 3: Run backup anytime
gitlo

# Update existing backups
gitlo --update
```

### Without Config (One-Time Use)

```bash
# Using environment variable
export GITHUB_TOKEN=your_token_here
gitlo

# Using CLI argument
gitlo -t your_token_here
```

### Common Workflows

```bash
# Dry run to preview what will be backed up
gitlo --dry-run

# Backup to specific directory (overrides config)
gitlo -o ~/backups/my-github-repos

# Use SSH for cloning (requires SSH key setup)
gitlo -m ssh

# Only public repos, no forks
gitlo --exclude-private

# Include forks
gitlo --include-forks

# Weekly update of all existing backups
gitlo --update
```

## Development

If you want to contribute or modify the code:

```bash
# Install all dependencies (including dev)
npm install

# Build TypeScript to JavaScript
npm run build

# Run in development mode
npm run dev

# Clean build artifacts
npm run clean

# Test local changes globally
npm link --global
```

### Publishing

When you're ready to publish to npm:

```bash
# The prepublishOnly script automatically builds before publishing
npm publish
```

## What Gets Backed Up?

- ✅ All your repositories (public by default)
- ✅ Private repositories (if `--include-private`)
- ✅ Forks (if `--include-forks`)
- ✅ Full git history and all branches
- ⚠️ Issues, PRs, and wiki pages are NOT included (only git repos)

## Output Structure

```
your-backup-directory/
├── repo-1/
│   └── .git/
├── repo-2/
│   └── .git/
└── repo-3/
    └── .git/
```

## Automation

### Automatic Backups with Cron (Built-in)

`gitlo` has a built-in scheduler to automatically backup your repos:

```bash
# Setup weekly backups (default: Sundays at 2 AM)
# By default, updates existing repos (faster)
gitlo schedule setup

# Setup daily backups at 3 AM
gitlo schedule setup --frequency daily --time 03:00

# Setup weekly on Mondays at 2 AM
gitlo schedule setup --frequency weekly --day 1 --time 02:00

# Full backup (clone all repos including new ones)
gitlo schedule setup --full

# View scheduled jobs
gitlo schedule list

# Remove scheduled backups
gitlo schedule remove
```

#### Schedule Options

- `-f, --frequency <freq>` - hourly, daily, weekly, monthly (default: weekly)
- `-t, --time <time>` - Time in HH:MM format (default: 02:00)
- `-d, --day <day>` - Day of week 0-6 for weekly (0=Sunday, default: 0)
- `--full` - Clone all repos instead of just updating existing (default: update)
- `-l, --log <path>` - Log file path (default: ~/.gitlo/backup.log)

**Note:** By default, scheduled backups update existing repositories for faster execution. Use `--full` to clone all repositories including new ones.

### Manual Cron Setup (Advanced)

If you prefer manual setup:

```bash
# Edit crontab
crontab -e

# Add line to backup weekly (Sundays at 2 AM)
0 2 * * 0 /usr/local/bin/gitlo --update >> /var/log/gitlo.log 2>&1
```

### Quick Install (npm)

```bash
npm install -g gitlo && gitlo config set token YOUR_TOKEN && gitlo
```

### One-liner for Development Setup

```bash
cd ~ && git clone https://github.com/dropocol/gitlo.git && cd gitlo && npm install && npm run build && npm link --global && echo "Setup complete. Run: gitlo config set token YOUR_TOKEN"
```

## Security Notes

- Your GitHub token is stored in `~/.gitlo/config.json` on your local machine
- The token is masked when displayed (shows: `ghp_****xxxx`)
- Keep your config file secure - it contains your GitHub token!
- Use file permissions to protect the config: `chmod 600 ~/.gitlo/config.json`

## Troubleshooting

### "Not all repositories were backed up"

If `gitlo` reports fewer repositories than you have on GitHub, it's likely due to filtering:

**1. Forks are excluded by default**

```bash
# Check if you have forks being skipped
gitlo --dry-run

# Include forks in backup
gitlo --include-forks
```

**2. Private repos might be excluded**

```bash
# By default, private repos ARE included
# But if you used --exclude-private:
gitlo --include-private
```

**3. Use verbose mode to see what's being filtered**

```bash
# See detailed information about fetching and filtering
gitlo -v
```

### "Bad credentials" Error

Your token is invalid or expired. Generate a new one at [https://github.com/settings/tokens](https://github.com/settings/tokens)

### SSH Cloning Fails

Make sure you have SSH keys set up:

```bash
ssh-keygen -t ed25519 -C "your@email.com"
ssh-add ~/.ssh/id_ed25519
# Add public key to GitHub: https://github.com/settings/keys
```

### Rate Limiting

The tool handles pagination automatically. If you have 1000+ repos, it may take a while.

## License

MIT