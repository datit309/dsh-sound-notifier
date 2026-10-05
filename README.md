# dsh-telegram-bridge

[English](README.md) | [Tiếng Việt](README.vi.md)

Full two-way Telegram remote control, real-time progress tracking, and native OS notifications for DeepSeek Harness (DSH).

Turn your phone into a remote coding cockpit for your local DSH agent: send text prompts, voice messages, screenshots, inspect live diffs, switch models/sessions, execute shell commands, approve tools, and download generated deliverables.

---

## Key Features

### 1. Two-Way Remote Control via Telegram
- 💬 **Remote Prompting**: Send any text message in Telegram; the active agent on your Mac receives and runs it immediately.
- 🎙 **Voice-to-Text**: Hold to record a voice message (`.ogg`). The bot converts audio via `ffmpeg` + Gemini speech-to-text into a clean text prompt for the agent.
- 📷 **Vision / Screenshots**: Send terminal or UI bug screenshots with optional captions; the agent parses the image and fixes the code.
- 📁 **Document Upload**: Send `.pdf`, `.sql`, `.json`, `.py`, `.js`, `.txt` files directly to your agent's workspace.
- ⚡ **Live Progress Card**: Dynamically updates tool execution steps (`read`, `edit`, `bash`, `serena`, etc.) in a single message with typing indicators, preventing notification spam.
- 🔘 **Post-Turn Action Bar**: Every completed turn includes one-touch inline buttons: `[ 📄 View Diff ]`, `[ 📁 Modified Files ]`, `[ 🚀 Git Status ]`, `[ 🔇 Mute/Unmute ]`, `[ 🔄 New Session ]`.

### 2. Source Code & System Management
- 📄 **Live Git Diff (`/diff`)**: View detailed staged and unstaged code changes within the active workspace.
- 🚀 **Git Commit & Push (`/commit <message>`)**: Run `git add -A && git commit -m <msg> && git push` directly from your phone.
- 💻 **Direct Shell Execution (`/sh <command>`)**: Run terminal commands (e.g. `git status`, `pnpm test`, `docker ps`, `pm2 status`) locally with zero LLM token cost.
- 📥 **One-Touch File Download (`/get <file>`)**: Download files from your host machine with one click in `/files` or via `/get <path>`.
- 🎁 **Deliverable Auto-Delivery**: When the agent calls the `present` tool, generated deliverables are automatically uploaded to your Telegram chat.

### 3. Session & Workspace Navigation
- 📋 **Session Switching (`/sessions`, `/switch <index>`)**: List all open DSH sessions and switch active targets with inline buttons or indices.
- 📂 **Workspace Switching (`/workspaces`, `/cd <path>`)**: Browse project directories and change working directories on the fly.
- 🧠 **Model Switcher (`/model`)**: Switch between models (Gemini 3.8 Flash, Claude 4.6 Sonnet, GPT-6 Astra, etc.) via interactive inline buttons.
- 🔄 **New Session (`/new`)**: Spawn a fresh session in the active workspace.

### 4. Interactive Permissions & Security
- 🛡 **Tool Approval Buttons**: When an agent requests elevated permissions (`approval/asked`), the bot prompts with `[ ✅ Allow ]` and `[ ❌ Reject ]`.
- ❓ **User Questions (`ask_user_question`)**: Interactive single/multi-choice buttons for agent questions.
- 🔒 **Chat ID Locking**: Only authorized Telegram chat IDs can interact; unauthorized access receives a 403 response.

### 5. Native OS Audio & Desktop Notifications
- 🔊 **System Audio**: Native macOS audio alerts via `afplay` (`Hero.aiff` on success, `Basso.aiff` on error, `Ping.aiff` on prompt/approval).
- 🔔 **Desktop Banners**: macOS Notification Center banners with project name, execution time, and modified file list.
- 🔇 **Remote Mute (`/mute`, `/unmute`)**: Mute Mac speakers from your phone when you need silence.

---

## Telegram Command Reference

| Command | Description |
|:--- |:--- |
| **Send Voice Message** | Converts speech to text and dispatches as a prompt |
| **Send Photo + Caption** | Attaches screenshot for vision-based bug fixing |
| **Send Document** | Uploads code or docs into workspace for analysis |
| `/diff` | Displays git diff for the active workspace |
| `/commit <msg>` | Commits and pushes changes to git remote |
| `/sh <command>` | Runs shell commands directly on host (0 tokens) |
| `/get <file>` | Downloads file from host machine to Telegram |
| `/files` | Lists recently modified files with 1-click download buttons |
| `/workspaces` | Lists available workspaces with quick-switch buttons |
| `/cd <path>` | Changes agent's working directory |
| `/model` | Opens interactive model selection menu |
| `/sessions` | Lists open sessions with quick-switch buttons |
| `/switch <index>` | Switches to session by index or ID |
| `/mute` | Mutes Mac speaker sounds |
| `/unmute` | Unmutes Mac speaker sounds |
| `/new` | Spawns a new session |
| `/status` | Shows status of agent, session, workspace, and speaker |
| `/stop` | Aborts current agent turn immediately |
| `/help` | Displays help message and command list |

---

## Installation Guide for DSH

### Option 1: Via DSH CLI (Recommended)

Run the standard `dsh plugin add` command in your terminal:

```bash
# Install directly from GitHub into your active profile (e.g. web)
dsh plugin --profile web add github:datit309/dsh-telegram-bridge
```

Or install from a local checkout:

```bash
# Clone the repository
git clone https://github.com/datit309/dsh-telegram-bridge.git ~/dsh-telegram-bridge

# Install into DSH profile
dsh plugin --profile web add ~/dsh-telegram-bridge
```

> `dsh plugin add` automatically records the dependency in `~/.dsh/profiles/web/package.json` and activates the bundle layer in `dsh.profile.bundles`.

---

### Option 2: Via DSH Web GUI

1. Open DeepSeek Harness Web GUI (`http://127.0.0.1:3080`).
2. Click the **Plugins icon (puzzle piece)** in the far-left sidebar.
3. Click **Add plugin** in the top-right corner.
4. Enter the GitHub repository specifier:
   ```text
   github:datit309/dsh-telegram-bridge
   ```
5. Click **Install**. The plugin will be downloaded, bundled, and activated automatically.

---

### Option 3: Manual Setup (Local Development)

1. Add the package to `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": {
    "dsh-telegram-bridge": "file:/path/to/dsh-telegram-bridge"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-telegram-bridge"
      ]
    }
  }
}
```

2. Symlink into `node_modules` (if developing locally without pnpm install):
```bash
ln -sf /path/to/dsh-telegram-bridge ~/.dsh/profiles/web/node_modules/dsh-telegram-bridge
```

3. Enable in `~/.dsh/profiles/web/cordis.patch.yml`:
```yaml
- id: dsh-telegram-bridge
  name: "dsh-telegram-bridge"
```

---

## Configuration

### Method 1: `~/.dsh/telegram.json` (Recommended)
Create or edit `~/.dsh/telegram.json`:
```json
{
  "token": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID"
}
```

> **Auto-Pairing**: Leave `chatId` empty, then send `/start` to your bot from your phone. The bot will automatically lock to your chat ID.

### Method 2: DSH Web GUI
Navigate to **Settings (gear icon in lower-left) ➔ Telegram & Notifier**: Configure Token, Chat ID, sound/notification toggles, and click **Save**.

### Method 3: Environment Variables
```bash
export TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
export TELEGRAM_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
```

---

## Running

Restart your DSH web service:

```bash
# If dsh web is currently running, stop it with Ctrl+C, then:
dsh web
```

Open Telegram on your phone, find your bot, and send `/start`.

---

## License

MIT
