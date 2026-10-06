import { execFile } from 'node:child_process';
import { basename, isAbsolute, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';

export const name = 'dsh-telegram-bridge';
export const inject = ['sessions', 'agents'];

/** Cordis configuration schema exposed directly to the DSH Web Settings UI. */
export const Config = z.object({
  token: z.string().role('secret').description('Telegram Bot Token (lấy từ @BotFather)').volatile(),
  chatId: z.string().description('Telegram Chat ID (tự động điền khi bạn gửi /start)').volatile(),
  sound: z.boolean().default(true).description('Bật âm thanh hệ thống qua loa Mac').volatile(),
  notification: z.boolean().default(true).description('Hiện thông báo banner trên màn hình macOS').volatile(),
  volume: z.number().min(0).max(1).step(0.1).default(1).description('Âm lượng thông báo (0.0 đến 1.0)').volatile(),
});

// ponytail: Native OS audio, AppleScript notifications & Telegram 2-way Bot.
const DEFAULT_SOUNDS = {
  darwin: {
    success: '/System/Library/Sounds/Hero.aiff',
    error: '/System/Library/Sounds/Basso.aiff',
    interrupted: '/System/Library/Sounds/Tink.aiff',
    prompt: '/System/Library/Sounds/Ping.aiff',
  },
  linux: {
    success: '/usr/share/sounds/freedesktop/stereo/complete.oga',
    error: '/usr/share/sounds/freedesktop/stereo/dialog-error.oga',
    interrupted: '/usr/share/sounds/freedesktop/stereo/dialog-warning.oga',
    prompt: '/usr/share/sounds/freedesktop/stereo/message.oga',
  },
};

const POPULAR_MODELS = [
  { id: 'ag/gemini-3.8-flash-high', label: '⚡ Gemini 3.8 Flash (High)' },
  { id: 'ag/gemini-3.7-flash-high', label: '⚡ Gemini 3.7 Flash (High)' },
  { id: 'ag/claude-sonnet-4-6', label: '🧠 Claude 4.6 Sonnet' },
  { id: 'ag/claude-opus-4-6-thinking', label: '🧠 Claude 4.6 Opus Thinking' },
  { id: 'cx/gpt-6-astra', label: '🚀 GPT-6 Astra' },
  { id: 'cx/gpt-5.6-sol', label: '🚀 GPT-5.6 Sol' },
  { id: 'qwen-web/qwen3.7-max', label: '🌐 Qwen 3.7 Max' },
  { id: 'auto', label: '🔄 Auto Router' },
];

const BOT_COMMANDS = [
  { command: 'sessions', description: 'Danh sách & chọn session chat' },
  { command: 'switch', description: 'Đổi session: /switch <số>' },
  { command: 'workspaces', description: 'Danh sách thư mục Workspace' },
  { command: 'cd', description: 'Đổi thư mục: /cd <đường dẫn>' },
  { command: 'model', description: 'Xem & đổi Model AI' },
  { command: 'diff', description: 'Xem code vừa sửa (Git Diff)' },
  { command: 'commit', description: 'Commit & push git: /commit <msg>' },
  { command: 'sh', description: 'Chạy lệnh shell: /sh <lệnh>' },
  { command: 'get', description: 'Tải file về máy: /get <file>' },
  { command: 'files', description: 'Danh sách file vừa sửa' },
  { command: 'mute', description: 'Tắt âm thanh loa Mac' },
  { command: 'unmute', description: 'Bật lại âm thanh loa Mac' },
  { command: 'new', description: 'Mở session làm việc mới' },
  { command: 'status', description: 'Xem trạng thái Agent & Session' },
  { command: 'stop', description: 'Dừng khẩn cấp lượt chạy' },
  { command: 'help', description: 'Xem hướng dẫn sử dụng' },
];

async function syncBotCommands(token) {
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_COMMANDS }),
    });
  } catch {}
}

let lastSoundAt = 0;

function readVolatile(val, fallback = undefined) {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'object' && typeof val.get === 'function') {
    return val.get() ?? fallback;
  }
  return val;
}

function playSound(type, volume = 1, customSounds = {}) {
  const now = Date.now();
  if (now - lastSoundAt < 300) return;
  lastSoundAt = now;

  if (process.platform === 'darwin') {
    const file = customSounds[type] || DEFAULT_SOUNDS.darwin[type] || DEFAULT_SOUNDS.darwin.success;
    execFile('afplay', ['-v', String(volume), file], () => {});
  } else if (process.platform === 'linux') {
    const file = customSounds[type] || DEFAULT_SOUNDS.linux[type];
    if (file) {
      execFile('paplay', [file], (err) => {
        if (err) execFile('aplay', [file], () => {});
      });
    }
  } else if (process.platform === 'win32') {
    const soundType = type === 'error' ? 'Hand' : (type === 'prompt' ? 'Question' : 'Asterisk');
    execFile('powershell', ['-c', `[System.Media.SystemSounds]::${soundType}.Play()`], () => {});
  }
}

function showNotification(title, message, subtitle) {
  if (process.platform === 'darwin') {
    let script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
    if (subtitle) script += ` subtitle ${JSON.stringify(subtitle)}`;
    execFile('osascript', ['-e', script], () => {});
  } else if (process.platform === 'linux') {
    execFile('notify-send', [title, `${subtitle ? subtitle + '\n' : ''}${message}`], () => {});
  }
}

function truncate(str, maxLen = 80) {
  if (!str || typeof str !== 'string') return '';
  const clean = str.replace(/\s+/g, ' ').trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

function truncateLines(str, maxLen = 3000) {
  if (!str || typeof str !== 'string') return '';
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 3)}...`;
}

function formatDuration(ms) {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getProjectName(session) {
  const cwd = session?.header?.cwd;
  if (!cwd) return 'DSH';
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.pop() || 'DSH';
}

function getBeeRouterApiKey() {
  if (process.env.BEE_ROUTER_API_KEY) return process.env.BEE_ROUTER_API_KEY;
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
  const yamlPath = join(home, '.credentials.yaml');
  try {
    if (existsSync(yamlPath)) {
      const content = readFileSync(yamlPath, 'utf8');
      const match = content.match(/BEE_ROUTER_API_KEY:\s*([^\s\n]+)/);
      if (match) return match[1];
    }
  } catch {}
  return '';
}

function extractToolFilePath(name, args) {
  if (!args || typeof args !== 'object') return null;
  if (name === 'edit' || name === 'write' || name === 'write_file' || name === 'create_file') {
    return args.file_path || args.path || null;
  }
  if (name === 'str_replace_editor') {
    return args.path || null;
  }
  if (typeof name === 'string' && (name.includes('serena') || name.includes('replace_symbol') || name.includes('insert_after') || name.includes('insert_before') || name.includes('replace_in_files'))) {
    return args.relative_path || args.file_path || args.path || null;
  }
  return null;
}

function summarizeToolCall(name, args) {
  if (!args || typeof args !== 'object') return `Thao tác ${name}`;
  if (name === 'read' || name === 'view') {
    const f = basename(args.file_path || args.path || '');
    return f ? `Đọc \`${f}\`` : 'Đọc file';
  }
  if (name === 'read_image') {
    const f = basename(args.file_path || args.path || '');
    return f ? `Xem ảnh \`${f}\`` : 'Đọc ảnh';
  }
  if (name === 'edit' || name === 'str_replace_editor') {
    const f = basename(args.file_path || args.path || '');
    return f ? `Sửa \`${f}\`` : 'Chỉnh sửa file';
  }
  if (name === 'write' || name === 'write_file' || name === 'create_file') {
    const f = basename(args.file_path || args.path || '');
    return f ? `Tạo \`${f}\`` : 'Ghi file';
  }
  if (name === 'bash') {
    const cmd = truncate(args.command || args.cmd || '', 30);
    return cmd ? `Chạy \`${cmd}\`` : 'Chạy lệnh bash';
  }
  if (name === 'grep' || name === 'glob') {
    const p = truncate(args.pattern || '', 25);
    return p ? `Tìm \`${p}\`` : 'Tìm kiếm file';
  }
  if (name === 'present') {
    return 'Bàn giao file kết quả';
  }
  if (typeof name === 'string' && name.startsWith('mcp__serena__')) {
    const sub = name.replace('mcp__serena__', '');
    return `Serena: ${sub}`;
  }
  if (typeof name === 'string' && name.startsWith('mcp__codebase-memory__')) {
    const sub = name.replace('mcp__codebase-memory__', '');
    return `Graph: ${sub}`;
  }
  return `Gọi \`${name}\``;
}

// Last-processed time on every outgoing/edited message (edits keep Telegram's original timestamp).
function stamp(text) {
  return `${text}\n\n🕐 ${new Date().toLocaleString('vi-VN', { hour12: false })}`;
}

function splitMessage(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen / 2) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function loadTelegramConfig(config = {}) {
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
  const configFilePath = join(home, 'telegram.json');
  let fileConfig = {};
  try {
    if (existsSync(configFilePath)) {
      fileConfig = JSON.parse(readFileSync(configFilePath, 'utf8'));
    }
  } catch {}

  const rawToken = readVolatile(config.token) || config.telegram?.token || process.env.TELEGRAM_BOT_TOKEN || fileConfig.token || '';
  const rawChatId = readVolatile(config.chatId) || config.telegram?.chatId || process.env.TELEGRAM_CHAT_ID || fileConfig.chatId || '';
  return { token: String(rawToken).trim(), chatId: String(rawChatId).trim(), configFilePath };
}

function saveTelegramConfig(filePath, token, chatId) {
  try {
    writeFileSync(filePath, JSON.stringify({ token, chatId }, null, 2), 'utf8');
  } catch (e) {
    console.error('[dsh-telegram-bridge] Failed to save telegram.json:', e.message);
  }
}

function getSessionSummary(session) {
  if (!session) return { id: 'none', project: 'DSH', prompt: '' };
  const project = getProjectName(session);
  let firstPrompt = '';
  try {
    const events = session.snapshotEvents();
    for (const ev of events) {
      if (ev.type === 'user/message') {
        const c = ev.data?.content;
        if (typeof c === 'string') firstPrompt = c;
        else if (Array.isArray(c)) firstPrompt = c.map(p => (typeof p === 'string' ? p : p.text || '')).join(' ');
        if (firstPrompt) break;
      }
    }
  } catch {}
  return {
    id: session.id,
    project,
    prompt: firstPrompt ? truncate(firstPrompt, 40) : '',
  };
}

function getSessionCurrentModel(session) {
  if (!session) return 'ag/gemini-3.8-flash-high';
  try {
    const events = session.snapshotEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === 'model/selection' && events[i].data?.model) {
        return events[i].data.model;
      }
    }
  } catch {}
  return 'ag/gemini-3.8-flash-high';
}

function listAvailableWorkspaces(ctx) {
  const set = new Map();
  try {
    const regList = ctx.workspaceRegistry?.list?.() || [];
    for (const ws of regList) {
      if (ws.path && existsSync(ws.path)) {
        set.set(ws.path, { title: ws.title || basename(ws.path), path: ws.path });
      }
    }
  } catch {}

  try {
    const sessions = ctx.sessions?.list?.() || [];
    for (const s of sessions) {
      const c = s.header?.cwd;
      if (c && existsSync(c) && !set.has(c)) {
        set.set(c, { title: basename(c), path: c });
      }
    }
  } catch {}

  const baseDirs = [process.cwd()];
  try {
    const parentDir = join(process.cwd(), '..');
    if (existsSync(parentDir)) baseDirs.push(parentDir);
  } catch {}
  for (const b of baseDirs) {
    if (existsSync(b)) {
      if (!set.has(b)) set.set(b, { title: basename(b), path: b });
      try {
        const subs = readdirSync(b, { withFileTypes: true });
        for (const sub of subs) {
          if (sub.isDirectory() && !sub.name.startsWith('.')) {
            const p = join(b, sub.name);
            if (!set.has(p)) set.set(p, { title: sub.name, path: p });
          }
        }
      } catch {}
    }
  }

  return Array.from(set.values()).slice(0, 10);
}

function runGitDiff(cwd) {
  return new Promise((resolve) => {
    execFile('git', ['status', '--short'], { cwd }, (errStatus, statusOut) => {
      if (errStatus) {
        return resolve({ ok: false, error: 'Thư mục hiện tại không phải Git repository.' });
      }
      const trimmedStatus = (statusOut || '').trim();
      if (!trimmedStatus) {
        execFile('git', ['diff', 'HEAD~1', '--stat'], { cwd }, (errHead, headStat) => {
          if (!errHead && headStat && headStat.trim()) {
            return resolve({
              ok: true,
              clean: true,
              lastCommit: headStat.trim(),
            });
          }
          return resolve({ ok: true, clean: true });
        });
        return;
      }

      execFile('git', ['diff', '-U2'], { cwd }, (errDiff, diffOut) => {
        execFile('git', ['diff', '--stat'], { cwd }, (errStat, statOut) => {
          resolve({
            ok: true,
            clean: false,
            status: trimmedStatus,
            stat: (statOut || '').trim(),
            diff: (diffOut || '').trim(),
          });
        });
      });
    });
  });
}

export function apply(ctx, config = {}) {
  let soundEnabled = readVolatile(config.sound) !== false;
  let notifyEnabled = readVolatile(config.notification) !== false;
  let volume = typeof readVolatile(config.volume) === 'number' ? readVolatile(config.volume) : 1;
  const customSounds = config.sounds || {};

  // Per-session tracking
  const sessionStates = new Map();
  let selectedSessionId = null;
  let lastActiveSessionId = null;

  function getSessionState(sid) {
    if (!sid) return null;
    let s = sessionStates.get(sid);
    if (!s) {
      s = {
        turnStartAt: Date.now(),
        lastPrompt: '',
        modifiedFiles: new Set(),
        toolCallsCount: 0,
        actionHistory: [],
        progressMsgId: null,
        lastProgressUpdateAt: 0,
        typingTimer: null,
        updateProgressTimer: null,
      };
      sessionStates.set(sid, s);
    }
    return s;
  }

  function getActiveSession() {
    if (selectedSessionId) {
      const s = ctx.sessions?.get(selectedSessionId);
      if (s) return s;
    }
    if (lastActiveSessionId) {
      const s = ctx.sessions?.get(lastActiveSessionId);
      if (s) return s;
    }
    const list = ctx.sessions?.list?.() || [];
    return list[list.length - 1] || null;
  }

  async function resolveLiveAgent(session) {
    if (!session) return null;
    let agent = ctx.agents?.get(session.id);
    if (!agent && typeof ctx.agents?.resume === 'function') {
      try {
        const handle = await ctx.agents.resume({ resumeSessionId: session.id });
        agent = handle?.agent || ctx.agents.get(session.id);
      } catch (e) {
        console.warn('[dsh-telegram-bridge] Failed to resume agent:', e.message);
      }
    }
    return agent || null;
  }

  // --- Telegram Bot Engine ---
  const tgConfig = loadTelegramConfig(config);
  let botToken = tgConfig.token;
  let botChatId = tgConfig.chatId;
  const botConfigPath = tgConfig.configFilePath;

  // Sync back to telegram.json if provided from Web GUI
  if (readVolatile(config.token)) {
    saveTelegramConfig(botConfigPath, botToken, botChatId);
  }

  // Register Web API endpoints for Settings UI
  if (ctx.inject) {
    ctx.inject(['webServer'], (scope) => {
      scope.effect(() => {
        const d1 = scope.webServer.register({
          kind: 'exact',
          path: '/api/dsh-telegram-bridge/config',
          handler: async (req, res) => {
            if (req.method === 'GET') {
              const effective = loadTelegramConfig(config);
              let botInfo = null;
              if (effective.token) {
                try {
                  const r = await fetch(`https://api.telegram.org/bot${effective.token}/getMe`);
                  const d = await r.json();
                  if (d.ok) botInfo = d.result;
                } catch {}
              }
              sendJson(res, 200, {
                ok: true,
                config: {
                  token: effective.token,
                  chatId: effective.chatId,
                  sound: soundEnabled,
                  notification: notifyEnabled,
                  volume,
                },
                botInfo,
              });
              return;
            }

            if (req.method === 'POST') {
              try {
                const body = await readJsonBody(req);
                const newToken = String(body.token || '').trim();
                const newChatId = String(body.chatId || '').trim();
                if (typeof body.sound === 'boolean') soundEnabled = body.sound;
                if (typeof body.notification === 'boolean') notifyEnabled = body.notification;
                if (typeof body.volume === 'number') volume = body.volume;

                botToken = newToken;
                botChatId = newChatId;
                saveTelegramConfig(botConfigPath, botToken, botChatId);

                let botInfo = null;
                if (botToken) {
                  try {
                    const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
                    const d = await r.json();
                    if (d.ok) {
                      botInfo = d.result;
                      syncBotCommands(botToken);
                    }
                  } catch {}
                }

                sendJson(res, 200, { ok: true, botInfo });
              } catch (e) {
                sendJson(res, 400, { ok: false, error: e.message });
              }
              return;
            }

            sendJson(res, 405, { error: 'Method Not Allowed' });
          },
        });

        const d2 = scope.webServer.register({
          kind: 'exact',
          path: '/api/dsh-telegram-bridge/test',
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { error: 'Method Not Allowed' });
              return;
            }
            try {
              const body = await readJsonBody(req);
              const testToken = String(body.token || botToken || '').trim();
              const testChatId = String(body.chatId || botChatId || '').trim();

              if (!testToken || !testChatId) {
                sendJson(res, 400, { ok: false, error: 'Chưa có Token hoặc Chat ID để kiểm tra.' });
                return;
              }

              const r = await fetch(`https://api.telegram.org/bot${testToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: testChatId,
                  text: stamp('🚀 *Tin nhắn kiểm tra từ Giao diện DSH Web GUI!*\nCấu hình Telegram Bot đã hoạt động hoàn hảo.'),
                  parse_mode: 'Markdown',
                }),
              });
              const d = await r.json();
              if (d.ok) {
                sendJson(res, 200, { ok: true });
              } else {
                sendJson(res, 400, { ok: false, error: d.description || 'Telegram từ chối gửi tin nhắn.' });
              }
            } catch (e) {
              sendJson(res, 500, { ok: false, error: e.message });
            }
          },
        });

        return () => {
          d1();
          d2();
        };
      }, 'dsh-sound-notifier: webServer API routes');
    });
  }

  const pendingApprovals = new Map();
  const pendingQuestions = new Map();
  let approvalCounter = 0;
  let questionCounter = 0;

  const abortController = new AbortController();
  const signal = abortController.signal;

  async function tgSend(text, options = {}) {
    if (!botToken || !botChatId || !text) return null;
    text = stamp(text);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: botChatId,
          text,
          parse_mode: 'Markdown',
          ...options,
        }),
      });
      const data = await res.json();
      if (!data.ok && data.description?.includes("can't parse entities")) {
        const fallback = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: botChatId,
            text,
            ...options,
          }),
        });
        return await fallback.json();
      }
      return data;
    } catch (err) {
      console.warn('[dsh-telegram-bridge] Telegram send error:', err.message);
      return null;
    }
  }

  async function tgSendChatAction(action = 'typing') {
    if (!botToken || !botChatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: botChatId,
          action,
        }),
      });
    } catch {}
  }

  async function tgSendDocument(filePath, caption = '') {
    if (!botToken || !botChatId || !filePath) return null;
    try {
      if (!existsSync(filePath)) return null;
      const stats = statSync(filePath);
      if (!stats.isFile() || stats.size > 50 * 1024 * 1024) return null;

      const fileBuffer = readFileSync(filePath);
      const form = new FormData();
      form.append('chat_id', botChatId);
      form.append('caption', stamp(caption).trim());
      const blob = new Blob([fileBuffer]);
      form.append('document', blob, basename(filePath));

      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
        method: 'POST',
        body: form,
      });
      return await res.json();
    } catch (err) {
      console.warn('[dsh-telegram-bridge] sendDocument error:', err.message);
      return null;
    }
  }

  async function tgEdit(chatId, messageId, text, options = {}) {
    if (!botToken || !messageId) return null;
    text = stamp(text);
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text,
          parse_mode: 'Markdown',
          ...options,
        }),
      });
      const data = await res.json();
      if (!data.ok && data.description?.includes("can't parse entities")) {
        const fallback = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text,
            ...options,
          }),
        });
        return await fallback.json();
      }
      return data;
    } catch {
      return null;
    }
  }

  async function tgAnswerCallback(queryId, text) {
    if (!botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: queryId,
          text: text || '',
        }),
      });
    } catch {}
  }

  async function transcribeVoice(fileId) {
    const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) {
      throw new Error(fileData.description || 'Không lấy được file_path từ Telegram');
    }

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const audioRes = await fetch(downloadUrl);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const tmpId = Date.now();
    const ogaPath = `/tmp/tg_voice_${tmpId}.oga`;
    const wavPath = `/tmp/tg_voice_${tmpId}.wav`;
    writeFileSync(ogaPath, audioBuffer);

    const ffmpegBin = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
    await new Promise((resolve, reject) => {
      execFile(ffmpegBin, ['-y', '-i', ogaPath, '-ar', '16000', '-ac', '1', wavPath], (err) => {
        if (err) reject(new Error(`Chuyển đổi audio bằng ffmpeg thất bại: ${err.message}`));
        else resolve();
      });
    });

    const wavBuffer = readFileSync(wavPath);
    const base64Audio = wavBuffer.toString('base64');

    try {
      if (existsSync(ogaPath)) unlinkSync(ogaPath);
      if (existsSync(wavPath)) unlinkSync(wavPath);
    } catch {}

    const apiKey = getBeeRouterApiKey();
    const routerRes = await fetch('http://localhost:20128/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'ag/gemini-3.8-flash-high',
        messages: [{
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: base64Audio, format: 'wav' } },
            { type: 'text', text: 'Transcribe this voice audio message verbatim in its original language. Output ONLY the transcription text, with no preamble, quotes, or markdown.' },
          ],
        }],
      }),
    });

    const respText = await routerRes.text();
    let transcript = '';
    for (const line of respText.split('\n')) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const d = JSON.parse(line.slice(6));
          transcript += d.choices?.[0]?.delta?.content || '';
        } catch {}
      }
    }

    const result = transcript.trim();
    if (!result) throw new Error('Không nhận diện được giọng nói trong bản ghi âm.');
    return result;
  }

  async function showSessionsListMenu() {
    const sessions = ctx.sessions?.list?.() || [];
    if (sessions.length === 0) {
      await tgSend('ℹ️ Hiện chưa có session nào trong DSH.\nGửi /new để tạo session mới.');
      return;
    }

    const current = getActiveSession();
    const buttons = [];
    const lines = ['📋 *Danh sách phiên làm việc (Sessions):*\n'];

    sessions.forEach((s, idx) => {
      const isCurrent = current && current.id === s.id;
      const summary = getSessionSummary(s);
      const agent = ctx.agents?.get(s.id);
      const isRunning = agent?.status === 'running';
      const statusIcon = isCurrent ? '🟢' : (isRunning ? '⚡' : '⚪️');
      const statusText = isRunning ? 'Đang chạy' : 'Đang rảnh';

      lines.push(
        `${statusIcon} *${idx + 1}. [${summary.project}]* \`${s.id}\`${isCurrent ? ' _(Đang chọn)_' : ''}\n` +
        `   • Trạng thái: ${statusText}` +
        (summary.prompt ? `\n   • Yêu cầu: _"${summary.prompt}"_` : '') + '\n',
      );

      const btnLabel = `${statusIcon} ${idx + 1}. [${summary.project}] ${s.id}${isCurrent ? ' ✓' : ''}`;
      buttons.push([{ text: btnLabel, callback_data: `switch:${s.id}` }]);
    });

    buttons.push([{ text: '➕ Mở Session Mới', callback_data: 'cmd:new' }]);
    lines.push('_Bấm nút bên dưới hoặc gõ `/switch <số>` để chuyển session:_');

    await tgSend(lines.join('\n'), {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }

  async function showWorkspacesMenu() {
    const workspaces = listAvailableWorkspaces(ctx);
    const currentCwd = getActiveSession()?.header?.cwd || process.cwd();

    const buttons = workspaces.map((ws, idx) => {
      const isCurrent = ws.path === currentCwd;
      return [{
        text: `${isCurrent ? '🟢 ' : '📂 '}${ws.title}${isCurrent ? ' (Active)' : ''}`,
        callback_data: `cd:${idx}`,
      }];
    });

    const lines = [
      '📂 *Danh sách Thư mục Workspace:*\n',
      `• *Hiện tại*: \`${currentCwd}\`\n`,
      '_Bấm nút bên dưới để đổi Workspace, hoặc gõ:_ `/cd <đường dẫn>`',
    ];

    await tgSend(lines.join('\n'), {
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  }

  async function changeWorkspace(targetPath) {
    if (!targetPath || !existsSync(targetPath)) {
      await tgSend(`❌ Thư mục không tồn tại: \`${targetPath}\``);
      return;
    }
    const stat = statSync(targetPath);
    if (!stat.isDirectory()) {
      await tgSend(`❌ Đường dẫn không phải thư mục: \`${targetPath}\``);
      return;
    }

    try {
      if (typeof ctx.agents?.create === 'function') {
        const handle = await ctx.agents.create({ meta: { cwd: targetPath } });
        const newSession = handle?.agent?.session;
        if (newSession) {
          selectedSessionId = newSession.id;
          lastActiveSessionId = newSession.id;
          await tgSend(
            `📂 *Đã đổi Workspace thành công!*\n` +
            `• *Thư mục*: \`${targetPath}\`\n` +
            `• *Session mới*: \`${newSession.id}\`\n` +
            `Mọi câu lệnh và prompt tiếp theo sẽ chạy trong thư mục này.`,
          );
          return;
        }
      }
      await tgSend('❌ Không thể khởi tạo session trong thư mục mới.');
    } catch (e) {
      await tgSend(`❌ Lỗi đổi workspace: ${e.message}`);
    }
  }

  async function showModelSelectionMenu() {
    const session = getActiveSession();
    const currentModel = getSessionCurrentModel(session);
    const project = getProjectName(session);

    const buttons = POPULAR_MODELS.map((m, idx) => {
      const isCurrent = m.id === currentModel;
      return [{
        text: `${isCurrent ? '🟢 ' : ''}${m.label}${isCurrent ? ' (Active)' : ''}`,
        callback_data: `model:${idx}`,
      }];
    });

    await tgSend(
      `🧠 *Chọn Model cho Session [${project}]*\n` +
      `• Model đang dùng: \`${currentModel}\`\n\n` +
      `_Bấm nút bên dưới để đổi model:_`,
      {
        reply_markup: {
          inline_keyboard: buttons,
        },
      },
    );
  }

  // Handle incoming Telegram commands / messages
  async function handleTelegramMessage(msg) {
    const fromId = String(msg.chat.id);
    const text = (msg.text || '').trim();

    // Auto-pairing when not paired yet
    if (!botChatId) {
      botChatId = fromId;
      saveTelegramConfig(botConfigPath, botToken, botChatId);
      await tgSend(
        `✅ *Kết nối DeepSeek Harness thành công!*\nĐã liên kết với tài khoản này (\`${botChatId}\`).\n\nTừ bây giờ bạn có thể nhận thông báo và gửi prompt điều khiển Agent trực tiếp từ đây.`,
      );
      return;
    }

    // Security check: only paired chatId is authorized
    if (fromId !== botChatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: fromId,
          text: '⛔ *Truy cập bị từ chối*: Bot này đã được liên kết với một tài khoản DSH khác.',
          parse_mode: 'Markdown',
        }),
      });
      return;
    }

    // --- 1. Voice Message (Voice to Text Prompt) ---
    const voiceFileId = msg.voice?.file_id || msg.audio?.file_id;
    if (voiceFileId) {
      const session = getActiveSession();
      const agent = await resolveLiveAgent(session);
      const project = getProjectName(session);

      if (!agent) {
        await tgSend('⚠️ Không tìm thấy session hoặc agent đang mở trên máy Mac.');
        return;
      }

      await tgSendChatAction('record_voice');
      await tgSend('🎙 *Đang chuyển đổi giọng nói thành văn bản...*');

      try {
        const transcript = await transcribeVoice(voiceFileId);
        await tgSend(`🎤 *Nhận diện giọng nói*: _"${transcript}"_`);

        const userMessage = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: transcript }],
          source: { kind: 'user' },
        };
        Object.freeze(userMessage);

        const isRunning = agent.status === 'running';
        agent.followup(userMessage);

        if (isRunning) {
          await tgSend(`⏳ *DSH [${project}]*: Agent đang bận. Đã xếp hàng prompt: _"${truncate(transcript, 60)}"_`);
        } else {
          await tgSend(`🚀 *DSH [${project}]*: Đang bắt đầu xử lý yêu cầu...`);
        }
      } catch (err) {
        await tgSend(`❌ Lỗi nhận diện giọng nói: ${err.message}`);
      }
      return;
    }

    // --- 2. Photo upload (Vision / Screenshot) ---
    if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
      const photo = msg.photo[msg.photo.length - 1];
      const caption = (msg.caption || '').trim();
      const session = getActiveSession();
      const agent = await resolveLiveAgent(session);
      const project = getProjectName(session);

      if (!agent) {
        await tgSend('⚠️ Không tìm thấy session hoặc agent đang mở trên máy Mac.');
        return;
      }

      await tgSend('📥 *Đang tải ảnh từ Telegram...*');

      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`);
        const fileData = await fileRes.json();
        if (!fileData.ok || !fileData.result?.file_path) {
          throw new Error(fileData.description || 'Không lấy được thông tin file từ Telegram');
        }

        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        const imgRes = await fetch(downloadUrl);
        const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

        const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
        const uploadDir = join(home, 'telegram-uploads');
        mkdirSync(uploadDir, { recursive: true });

        const fileName = `photo_${Date.now()}_${randomUUID().slice(0, 6)}.jpg`;
        const localFilePath = join(uploadDir, fileName);
        writeFileSync(localFilePath, imgBuffer);

        const promptText = `[Người dùng gửi kèm ảnh chụp màn hình: @${localFilePath}]\n${caption || 'Hãy xem và phân tích hình ảnh này để xử lý theo ngữ cảnh.'}`;

        const userMessage = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: promptText }],
          source: { kind: 'user' },
        };
        Object.freeze(userMessage);

        const isRunning = agent.status === 'running';
        agent.followup(userMessage);

        if (isRunning) {
          await tgSend(`⏳ *DSH [${project}]*: Đã nhận ảnh (\`${fileName}\`). Agent đang bận, đã xếp hàng yêu cầu.`);
        } else {
          await tgSend(`🚀 *DSH [${project}]*: Đã nhận ảnh (\`${fileName}\`).\nAgent đang bắt đầu phân tích và xử lý...`);
        }
      } catch (err) {
        await tgSend(`❌ Lỗi tải ảnh: ${err.message}`);
      }
      return;
    }

    // --- 3. Document upload (Code / Document to Agent) ---
    if (msg.document) {
      const doc = msg.document;
      const fileName = doc.file_name || `document_${Date.now()}`;
      const caption = (msg.caption || '').trim();
      const session = getActiveSession();
      const agent = await resolveLiveAgent(session);
      const project = getProjectName(session);

      if (!agent) {
        await tgSend('⚠️ Không tìm thấy session hoặc agent đang mở trên máy Mac.');
        return;
      }

      await tgSendChatAction('upload_document');
      await tgSend(`📥 *Đang tải file \`${fileName}\` về máy Mac...*`);

      try {
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${doc.file_id}`);
        const fileData = await fileRes.json();
        if (!fileData.ok || !fileData.result?.file_path) {
          throw new Error(fileData.description || 'Không lấy được thông tin file từ Telegram');
        }

        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
        const docRes = await fetch(downloadUrl);
        const docBuffer = Buffer.from(await docRes.arrayBuffer());

        const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
        const uploadDir = join(home, 'telegram-uploads');
        mkdirSync(uploadDir, { recursive: true });

        const localFilePath = join(uploadDir, fileName);
        writeFileSync(localFilePath, docBuffer);

        const promptText = `[Người dùng gửi kèm file tài liệu: @${localFilePath}]\n${caption || 'Hãy đọc và xử lý nội dung file này theo yêu cầu.'}`;

        const userMessage = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: promptText }],
          source: { kind: 'user' },
        };
        Object.freeze(userMessage);

        const isRunning = agent.status === 'running';
        agent.followup(userMessage);

        if (isRunning) {
          await tgSend(`⏳ *DSH [${project}]*: Đã nhận file \`${fileName}\`. Agent đang bận, đã xếp hàng yêu cầu.`);
        } else {
          await tgSend(`🚀 *DSH [${project}]*: Đã nhận file \`${fileName}\`.\nAgent đang bắt đầu đọc và xử lý...`);
        }
      } catch (err) {
        await tgSend(`❌ Lỗi tải file: ${err.message}`);
      }
      return;
    }

    if (!text) return;

    if (text === '/start' || text === '/help') {
      await tgSend(
        `🤖 *DeepSeek Harness Telegram Bot*\n` +
        `Điều khiển AI lập trình toàn diện từ điện thoại.\n\n` +
        `*Quản lý Session & Workspace:*\n` +
        `• /sessions - Xem danh sách & chọn Session chat\n` +
        `• /switch <số> - Đổi sang Session khác\n` +
        `• /workspaces - Danh sách thư mục Workspace\n` +
        `• /cd <path> - Đổi thư mục làm việc\n` +
        `• /new - Mở một phiên làm việc mới\n` +
        `• /status - Xem chi tiết Session & Workspace hiện tại\n\n` +
        `*Công cụ kỹ thuật & Mã nguồn:*\n` +
        `• /diff - Xem chi tiết mã nguồn vừa sửa (Git Diff)\n` +
        `• /commit <msg> - Commit & push git nhanh lên GitHub\n` +
        `• /sh <lệnh> - Chạy lệnh terminal trực tiếp (0 token)\n` +
        `• /get <file> - Tải file từ máy Mac về Telegram\n` +
        `• /files - Xem danh sách file vừa sửa (kèm nút tải)\n` +
        `• /model - Xem & đổi Model AI (Gemini, Claude, GPT)\n` +
        `• /mute - Tắt âm thanh loa Mac (chỉ rung Telegram)\n` +
        `• /unmute - Bật lại âm thanh loa Mac\n` +
        `• /stop - Dừng khẩn cấp lượt chạy hiện tại\n\n` +
        `🎙 *Tin nhắn thoại*: Gửi Voice Message để bot chuyển thành prompt chữ.\n` +
        `📷 *Gửi ảnh*: Gửi ảnh chụp màn hình để Agent đọc và sửa code.\n` +
        `📁 *Gửi file*: Gửi file .pdf, .txt, .sql, .js để Agent đọc và xử lý.\n` +
        `💬 *Gửi prompt*: Gõ tin nhắn bất kỳ để Agent thực thi.`,
      );
      return;
    }

    // --- 3. Run Shell command (/sh or /bash) ---
    if (text.startsWith('/sh') || text.startsWith('/bash')) {
      const cmd = text.replace(/^\/(?:sh|bash)\s*/, '').trim();
      const session = getActiveSession();
      const cwd = session?.header?.cwd || process.cwd();
      const project = getProjectName(session);

      if (!cmd) {
        await tgSend('ℹ️ *Cách dùng*: `/sh <lệnh shell>`\nVí dụ: `/sh git status`, `/sh git log -3`, `/sh pm2 status`');
        return;
      }

      await tgSendChatAction('typing');
      const start = Date.now();

      execFile('bash', ['-c', cmd], { cwd, timeout: 45000, maxBuffer: 1024 * 1024 }, async (err, stdout, stderr) => {
        const elapsed = formatDuration(Date.now() - start);
        const combined = ((stdout || '') + (stderr ? (stdout ? '\n' : '') + stderr : '')).trim();

        if (err && !combined) {
          await tgSend(`❌ *Lệnh*: \`${cmd}\` (${elapsed}) [${project}]\n*Lỗi*: ${err.message}`);
          return;
        }

        const header = `💻 *\`${cmd}\`* [${project}] (${elapsed}):\n`;
        if (!combined) {
          await tgSend(`${header}_(Lệnh thực thi thành công, không có output)_`);
          return;
        }

        if (combined.length <= 3200) {
          await tgSend(`${header}\`\`\`\n${combined}\n\`\`\``);
        } else {
          const truncatedText = combined.slice(0, 3000);
          await tgSend(`${header}\`\`\`\n${truncatedText}\n\`\`\`\n_(Output dài ${combined.length} ký tự, đã rút gọn)_`);
        }
      });
      return;
    }

    // --- 4. Get File from Mac (/get) ---
    if (text.startsWith('/get')) {
      const parts = text.split(/\s+/);
      const targetFile = parts[1];
      const session = getActiveSession();
      const cwd = session?.header?.cwd || process.cwd();
      const project = getProjectName(session);

      if (!targetFile) {
        const state = session ? getSessionState(session.id) : null;
        let hint = `ℹ️ *Cách dùng*: \`/get <đường dẫn file>\`\nVí dụ: \`/get package.json\`\n`;
        if (state && state.modifiedFiles.size > 0) {
          hint += `\n*Các file vừa sửa có thể tải:*\n${Array.from(state.modifiedFiles).map(f => `• \`/get ${f}\``).join('\n')}`;
        }
        await tgSend(hint);
        return;
      }

      const resolved = isAbsolute(targetFile) ? targetFile : join(cwd, targetFile);
      if (!existsSync(resolved)) {
        await tgSend(`❌ File không tồn tại trong workspace [${project}]: \`${targetFile}\``);
        return;
      }

      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        await tgSend(`❌ \`${targetFile}\` là thư mục, không phải file.`);
        return;
      }

      if (stat.size > 50 * 1024 * 1024) {
        await tgSend(`❌ File quá lớn (${formatBytes(stat.size)}), Telegram chỉ hỗ trợ gửi file tối đa 50MB.`);
        return;
      }

      await tgSendChatAction('upload_document');
      const sent = await tgSendDocument(resolved, `📄 [${project}] ${basename(resolved)}`);
      if (!sent?.ok) {
        await tgSend(`❌ Lỗi gửi file: ${sent?.description || 'Không gửi được'}`);
      }
      return;
    }

    // --- 5. Workspaces & CD (/workspaces, /cd) ---
    if (text === '/workspaces' || text === '/ws') {
      await showWorkspacesMenu();
      return;
    }

    if (text.startsWith('/cd')) {
      const parts = text.split(/\s+/);
      const targetDir = parts.slice(1).join(' ').trim();
      const session = getActiveSession();
      const currentCwd = session?.header?.cwd || process.cwd();

      if (!targetDir) {
        await showWorkspacesMenu();
        return;
      }

      const resolved = isAbsolute(targetDir) ? targetDir : join(currentCwd, targetDir);
      await changeWorkspace(resolved);
      return;
    }

    // --- 6. Model selection (/model) ---
    if (text === '/model' || text === '/models') {
      await showModelSelectionMenu();
      return;
    }

    // --- 7. Git Diff (/diff) ---
    if (text === '/diff') {
      const session = getActiveSession();
      const cwd = session?.header?.cwd || process.cwd();
      const project = getProjectName(session);

      await tgSendChatAction('typing');
      const diffResult = await runGitDiff(cwd);

      if (!diffResult.ok) {
        await tgSend(`❌ *Git Diff [${project}]*: ${diffResult.error}`);
        return;
      }

      if (diffResult.clean) {
        if (diffResult.lastCommit) {
          await tgSend(
            `ℹ️ *Git [${project}]*: Working tree đang sạch.\n\n` +
            `*Thay đổi ở commit gần nhất:*\n\`\`\`\n${diffResult.lastCommit}\n\`\`\``,
          );
        } else {
          await tgSend(`ℹ️ *Git [${project}]*: Working tree đang sạch, không có thay đổi nào chưa commit.`);
        }
        return;
      }

      let diffMsg = `📄 *Git Diff [${project}]:*\n\n*Trạng thái:*\n\`\`\`\n${diffResult.status}\n\`\`\`\n`;
      if (diffResult.stat) {
        diffMsg += `*Thống kê:*\n\`\`\`\n${diffResult.stat}\n\`\`\`\n`;
      }

      if (diffResult.diff) {
        const truncatedDiff = truncate(diffResult.diff, 2800);
        diffMsg += `*Diff chi tiết:*\n\`\`\`diff\n${truncatedDiff}\n\`\`\``;
        if (diffResult.diff.length > 2800) {
          diffMsg += '\n_(Đoạn diff dài, đã rút gọn)_';
        }
      }

      await tgSend(diffMsg);
      return;
    }

    if (text === '/sessions' || text === '/list') {
      await showSessionsListMenu();
      return;
    }

    if (text.startsWith('/switch')) {
      const parts = text.split(/\s+/);
      const arg = parts[1];
      const sessions = ctx.sessions?.list?.() || [];

      if (!arg) {
        await showSessionsListMenu();
        return;
      }

      let target = null;
      const num = Number.parseInt(arg, 10);
      if (!Number.isNaN(num) && num >= 1 && num <= sessions.length) {
        target = sessions[num - 1];
      } else {
        target = sessions.find(s => s.id === arg || s.id.toLowerCase() === arg.toLowerCase());
      }

      if (target) {
        selectedSessionId = target.id;
        const summary = getSessionSummary(target);
        await tgSend(
          `✅ *Đã chuyển sang session:*\n` +
          `• *Project*: \`${summary.project}\`\n` +
          `• *ID*: \`${target.id}\`\n` +
          `Mọi prompt bạn gửi tiếp theo sẽ chạy trong session này.`,
        );
      } else {
        await tgSend(`❌ Không tìm thấy session "${arg}". Gõ /sessions để xem danh sách.`);
      }
      return;
    }

    if (text === '/status') {
      const session = getActiveSession();
      const agent = await resolveLiveAgent(session);
      const project = getProjectName(session);
      const state = session ? getSessionState(session.id) : null;
      const statusText = agent ? (agent.status === 'running' ? '⚡ Đang chạy (running)' : '💤 Đang rảnh (idle)') : 'Chưa có Agent';
      const fileCount = state?.modifiedFiles?.size || 0;
      const currentModel = getSessionCurrentModel(session);

      await tgSend(
        `📊 *Trạng thái DeepSeek Harness*\n\n` +
        `• *Project*: \`${project}\`\n` +
        `• *Thư mục*: \`${session?.header?.cwd || process.cwd()}\`\n` +
        `• *Session đang chọn*: \`${session?.id || 'Không có'}\`\n` +
        `• *Model*: \`${currentModel}\`\n` +
        `• *Trạng thái*: ${statusText}\n` +
        `• *Loa Mac*: ${soundEnabled ? '🔊 Bật' : '🔇 Tắt'}\n` +
        `• *File vừa sửa*: ${fileCount} file\n` +
        (state?.lastPrompt ? `• *Prompt gần nhất*: _"${truncate(state.lastPrompt, 60)}"_\n` : '') +
        `\n_Lệnh: /sessions, /workspaces, /model, /diff, /commit, /sh, /mute._`,
      );
      return;
    }

    if (text === '/mute') {
      soundEnabled = false;
      await tgSend('🔇 *Đã tắt âm thanh loa Mac.*\nCác thông báo hoàn thành/lỗi sẽ chỉ rung trên điện thoại qua Telegram.');
      return;
    }

    if (text === '/unmute') {
      soundEnabled = true;
      await tgSend('🔊 *Đã bật lại âm thanh loa Mac.*');
      return;
    }

    // --- Git Commit & Push (/commit) ---
    if (text.startsWith('/commit')) {
      const parts = text.split(/\s+/);
      const commitMsg = parts.slice(1).join(' ').trim();
      const session = getActiveSession();
      const cwd = session?.header?.cwd || process.cwd();
      const project = getProjectName(session);

      if (!commitMsg) {
        await tgSend('ℹ️ *Cách dùng*: `/commit <nội dung commit>`\nVí dụ: `/commit feat: hoàn thiện tính năng telegram`');
        return;
      }

      await tgSendChatAction('typing');
      execFile('git', ['add', '-A'], { cwd }, (errAdd) => {
        if (errAdd) {
          tgSend(`❌ Lỗi git add: ${errAdd.message}`);
          return;
        }
        execFile('git', ['commit', '-m', commitMsg], { cwd }, (errCommit, commitOut) => {
          if (errCommit) {
            tgSend(`❌ Lỗi git commit: ${errCommit.message}\n${commitOut || ''}`);
            return;
          }
          execFile('git', ['push'], { cwd }, (errPush, pushOut, pushErr) => {
            if (errPush) {
              tgSend(`⚠️ *Đã commit nhưng chưa push được*:\n${errPush.message}\n${pushErr || ''}`);
              return;
            }
            tgSend(`🚀 *Git Commit & Push thành công [${project}]!*\n\`\`\`\n${(commitOut || '').trim()}\n\`\`\``);
          });
        });
      });
      return;
    }

    if (text === '/new') {
      try {
        const cwd = getActiveSession()?.header?.cwd || process.cwd();
        if (typeof ctx.agents?.create === 'function') {
          const handle = await ctx.agents.create({ meta: { cwd } });
          const newSession = handle?.agent?.session;
          if (newSession) {
            selectedSessionId = newSession.id;
            lastActiveSessionId = newSession.id;
            await tgSend(
              `✨ *Đã tạo session mới*: \`${newSession.id}\`\n` +
              `• *Workspace*: \`${getProjectName(newSession)}\`\n` +
              `Session này đã được tự động chọn làm active. Bạn có thể gửi prompt trực tiếp từ đây.`,
            );
            return;
          }
        }
        await tgSend('❌ Không thể khởi tạo session mới trên Host.');
      } catch (e) {
        await tgSend(`❌ Lỗi tạo session: ${e.message}`);
      }
      return;
    }

    if (text === '/stop') {
      const session = getActiveSession();
      const agent = await resolveLiveAgent(session);
      if (agent && agent.status === 'running') {
        agent.cancel('user');
        await tgSend('🛑 *Đã gửi lệnh dừng tới Agent.*');
      } else {
        await tgSend('ℹ️ Agent hiện đang rảnh, không có lượt chạy nào để dừng.');
      }
      return;
    }

    if (text === '/files') {
      const session = getActiveSession();
      const state = session ? getSessionState(session.id) : null;
      if (state && state.modifiedFiles.size > 0) {
        const filesArr = Array.from(state.modifiedFiles);
        const list = filesArr.map(f => `• \`${f}\``).join('\n');
        const buttons = filesArr.map(f => [{ text: `📥 Tải ${f}`, callback_data: `get:${f}` }]);
        await tgSend(`📁 *Các file đã sửa gần nhất:*\n${list}\n\n_Bấm nút bên dưới để tải trực tiếp về điện thoại:_`, {
          reply_markup: {
            inline_keyboard: buttons,
          },
        });
      } else {
        await tgSend('ℹ️ Chưa có file nào được sửa đổi trong lượt gần nhất.');
      }
      return;
    }

    // Check if user is replying to a pending question with text
    if (pendingQuestions.size > 0) {
      const [latestQKey, item] = [...pendingQuestions.entries()].pop();
      pendingQuestions.delete(latestQKey);
      const firstQ = item.questions?.[0];
      const qId = item.qId || firstQ?.id || 'question';
      item.resolve({
        answers: [{
          id: qId,
          selected: [],
          custom: text,
        }],
      });
      await tgSend(`✍️ *Đã ghi nhận câu trả lời:* "${text}"`);
      return;
    }

    // Otherwise: Treat as user prompt for the Agent!
    let session = getActiveSession();
    let agent = await resolveLiveAgent(session);

    if (!agent && typeof ctx.agents?.create === 'function') {
      try {
        const handle = await ctx.agents.create({ meta: { cwd: process.cwd() } });
        agent = handle?.agent;
        session = agent?.session || null;
        if (session) {
          selectedSessionId = session.id;
          lastActiveSessionId = session.id;
        }
      } catch (e) {
        console.warn('[dsh-telegram-bridge] Auto-create agent failed:', e.message);
      }
    }

    if (!agent) {
      await tgSend('⚠️ Không tìm thấy session hoặc agent đang mở trên máy Mac.');
      return;
    }

    const userMessage = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    };
    Object.freeze(userMessage);

    const isRunning = agent.status === 'running';
    agent.followup(userMessage);

    const project = getProjectName(session);
    if (isRunning) {
      await tgSend(`⏳ *DSH [${project}]* (\`${session.id}\`): Agent đang bận. Đã xếp hàng prompt: _"${truncate(text, 60)}"_`);
    } else {
      await tgSend(`🚀 *DSH [${project}]* (\`${session.id}\`): Đã nhận yêu cầu: _"${truncate(text, 60)}"_\nAgent đang bắt đầu xử lý...`);
    }
  }

  // Handle Telegram button clicks (Inline Keyboard)
  async function handleTelegramCallback(cq) {
    try {
      await tgAnswerCallback(cq.id, 'Đã ghi nhận!');
      const fromId = String(cq.from?.id || '');
      if (botChatId && fromId !== botChatId) return;

      const data = cq.data || '';
      const chatId = cq.message?.chat?.id || botChatId;
      const msgId = cq.message?.message_id;

      if (data === 'act:diff') {
        const session = getActiveSession();
        const cwd = session?.header?.cwd || process.cwd();
        const diffResult = await runGitDiff(cwd);
        if (!diffResult.ok) {
          await tgSend(`❌ ${diffResult.error}`);
          return;
        }
        if (diffResult.clean) {
          await tgSend('ℹ️ Working tree đang sạch, không có thay đổi nào chưa commit.');
          return;
        }
        const truncatedDiff = truncateLines(diffResult.diff, 2800);
        await tgSend(`📄 *Git Diff:*\n\`\`\`diff\n${truncatedDiff}\n\`\`\``);
        return;
      }

      if (data === 'act:files') {
        const session = getActiveSession();
        const cwd = session?.header?.cwd || process.cwd();
        const state = session ? getSessionState(session.id) : null;
        let filesArr = state && state.modifiedFiles.size > 0 ? Array.from(state.modifiedFiles) : [];

        if (filesArr.length === 0) {
          try {
            const out = await new Promise(res => execFile('git', ['status', '--short'], { cwd }, (_, stdout) => res(stdout || '')));
            const gitFiles = out.split('\n').map(l => l.trim().slice(3)).filter(Boolean);
            if (gitFiles.length > 0) filesArr = gitFiles;
          } catch {}
        }

        if (filesArr.length > 0) {
          const list = filesArr.map(f => `• \`${f}\``).join('\n');
          const buttons = filesArr.slice(0, 8).map(f => [{ text: `📥 Tải ${basename(f)}`, callback_data: `get:${f}` }]);
          await tgSend(`📁 *Các file đã sửa:*\n${list}\n\n_Bấm nút bên dưới để tải về điện thoại:_`, {
            reply_markup: { inline_keyboard: buttons },
          });
        } else {
          await tgSend('ℹ️ Chưa có file nào được sửa đổi.');
        }
        return;
      }

      if (data === 'act:gitstatus') {
        const session = getActiveSession();
        const cwd = session?.header?.cwd || process.cwd();
        execFile('git', ['status', '--short'], { cwd }, async (err, stdout) => {
          if (err) {
            await tgSend(`❌ Lỗi git status: ${err.message}`);
            return;
          }
          const out = (stdout || '').trim();
          await tgSend(`🚀 *Git Status:*\n\`\`\`\n${out || 'Working tree sạch.'}\n\`\`\``);
        });
        return;
      }

      if (data.startsWith('get:')) {
        const targetFile = data.replace('get:', '');
        const session = getActiveSession();
        const cwd = session?.header?.cwd || process.cwd();
        const project = getProjectName(session);

        const resolved = isAbsolute(targetFile) ? targetFile : join(cwd, targetFile);
        if (!existsSync(resolved)) {
          await tgSend(`❌ File không còn tồn tại: \`${targetFile}\``);
          return;
        }
        await tgSendChatAction('upload_document');
        const sent = await tgSendDocument(resolved, `📄 [${project}] ${basename(resolved)}`);
        if (!sent?.ok) {
          await tgSend(`❌ Lỗi gửi file: ${sent?.description || 'Không gửi được'}`);
        }
        return;
      }

      if (data === 'act:mute') {
        soundEnabled = false;
        if (msgId) await tgEdit(chatId, msgId, '🔇 *Đã tắt âm thanh loa Mac.*');
        else await tgSend('🔇 *Đã tắt âm thanh loa Mac.*');
        return;
      }

      if (data === 'act:unmute') {
        soundEnabled = true;
        if (msgId) await tgEdit(chatId, msgId, '🔊 *Đã bật lại âm thanh loa Mac.*');
        else await tgSend('🔊 *Đã bật lại âm thanh loa Mac.*');
        return;
      }

      if (data.startsWith('cd:')) {
        const idx = Number.parseInt(data.replace('cd:', ''), 10);
        const workspaces = listAvailableWorkspaces(ctx);
        const chosen = workspaces[idx];
        if (chosen && chosen.path) {
          await changeWorkspace(chosen.path);
        } else {
          if (msgId) await tgEdit(chatId, msgId, '❌ Workspace không còn khả dụng.');
          else await tgSend('❌ Workspace không còn khả dụng.');
        }
        return;
      }

      if (data.startsWith('model:')) {
        const idx = Number.parseInt(data.replace('model:', ''), 10);
        const chosen = POPULAR_MODELS[idx];
        const session = getActiveSession();
        if (!session || !chosen) {
          if (msgId) await tgEdit(chatId, msgId, '❌ Không thể đổi model lúc này.');
          else await tgSend('❌ Không thể đổi model lúc này.');
          return;
        }
        try {
          session.append('model/selection', { provider: 'bee-router', model: chosen.id });
          const project = getProjectName(session);
          const confirmText = `✅ *Đã đổi Model cho Session [${project}]:*\n• *Model mới*: \`${chosen.id}\` (${chosen.label})\nCác prompt tiếp theo sẽ chạy trên model này.`;
          if (msgId) await tgEdit(chatId, msgId, confirmText);
          else await tgSend(confirmText);
        } catch (e) {
          const errText = `❌ Lỗi khi đổi model: ${e.message}`;
          if (msgId) await tgEdit(chatId, msgId, errText);
          else await tgSend(errText);
        }
        return;
      }

      if (data.startsWith('switch:')) {
        const targetId = data.replace('switch:', '');
        const sessions = ctx.sessions?.list?.() || [];
        const s = ctx.sessions?.get(targetId) || sessions.find(item => item.id === targetId);
        if (s) {
          selectedSessionId = s.id;
          const summary = getSessionSummary(s);
          const confirmText = `✅ *Đã chuyển sang session:*\n• *Project*: \`${summary.project}\`\n• *ID*: \`${s.id}\`\nMọi prompt bạn gửi tiếp theo sẽ chạy trong session này.`;
          if (msgId) await tgEdit(chatId, msgId, confirmText);
          else await tgSend(confirmText);
        } else {
          const errText = `❌ Session \`${targetId}\` không còn tồn tại.`;
          if (msgId) await tgEdit(chatId, msgId, errText);
          else await tgSend(errText);
        }
        return;
      }

      if (data === 'cmd:new') {
        try {
          const cwd = getActiveSession()?.header?.cwd || process.cwd();
          if (typeof ctx.agents?.create === 'function') {
            const handle = await ctx.agents.create({ meta: { cwd } });
            const newSession = handle?.agent?.session;
            if (newSession) {
              selectedSessionId = newSession.id;
              lastActiveSessionId = newSession.id;
              const confirmText = `✨ *Đã tạo session mới*: \`${newSession.id}\`\n• *Workspace*: \`${getProjectName(newSession)}\`\nĐã tự động chọn session này làm active. Bạn có thể gửi prompt trực tiếp từ đây.`;
              if (msgId) await tgEdit(chatId, msgId, confirmText);
              else await tgSend(confirmText);
              return;
            }
          }
          if (msgId) await tgEdit(chatId, msgId, '❌ Không thể khởi tạo session mới trên Host.');
          else await tgSend('❌ Không thể khởi tạo session mới trên Host.');
        } catch (e) {
          const errText = `❌ Lỗi tạo session: ${e.message}`;
          if (msgId) await tgEdit(chatId, msgId, errText);
          else await tgSend(errText);
        }
        return;
      }

      if (data.startsWith('appr:')) {
        const [, action, apprKey] = data.split(':');
        const item = pendingApprovals.get(apprKey);
        if (item) {
          pendingApprovals.delete(apprKey);
          const approved = action === 'allow';
          item.resolve(approved ? 'allowed-once' : 'rejected');
          const toolLabel = item.toolName ? `: \`${item.toolName}\`` : '';
          const confirmText = approved
            ? `✅ *Đã cho phép thực thi*${toolLabel} _(xác nhận từ Telegram)_`
            : `❌ *Đã từ chối thực thi*${toolLabel} _(từ Telegram)_`;
          if (msgId) await tgEdit(chatId, msgId, confirmText);
          else await tgSend(confirmText);
        }
        return;
      }

      if (data.startsWith('ask:')) {
        const [, qKey, optIdxStr] = data.split(':');
        const item = pendingQuestions.get(qKey);
        if (item) {
          pendingQuestions.delete(qKey);
          const idx = Number.parseInt(optIdxStr, 10);
          const firstQ = item.questions?.[0];
          const selectedLabel = firstQ?.options?.[idx]?.label || 'Đồng ý';
          const qId = item.qId || firstQ?.id || 'question';
          item.resolve({
            answers: [{
              id: qId,
              selected: [selectedLabel],
            }],
          });
          const confirmText = `☑️ *Đã chọn*: *${selectedLabel}*`;
          if (msgId) await tgEdit(chatId, msgId, confirmText);
          else await tgSend(confirmText);
        }
        return;
      }
    } catch (err) {
      console.error('[dsh-telegram-bridge] Error in handleTelegramCallback:', err);
    }
  }

  // Long polling loop
  async function startTelegramPolling() {
    if (!botToken) {
      console.info('[dsh-telegram-bridge] Telegram token not configured in ~/.dsh/telegram.json.');
      return;
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const me = await meRes.json();
      if (!me.ok) {
        console.warn('[dsh-telegram-bridge] Telegram bot token invalid:', me.description);
        return;
      }
      console.info(`[dsh-telegram-bridge] Telegram Bot active: @${me.result.username}`);
      await syncBotCommands(botToken);
      if (!botChatId) {
        console.info(`[dsh-telegram-bridge] Send /start to @${me.result.username} to pair your Telegram chat.`);
      }
    } catch (e) {
      console.warn('[dsh-telegram-bridge] Telegram connection check failed:', e.message);
    }

    let offset = 0;
    while (!signal.aborted) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=25`, {
          signal,
        });
        if (!res.ok) {
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        const body = await res.json();
        if (body.ok && Array.isArray(body.result)) {
          for (const update of body.result) {
            offset = update.update_id + 1;
            if (update.message) {
              await handleTelegramMessage(update.message);
            } else if (update.callback_query) {
              await handleTelegramCallback(update.callback_query);
            }
          }
        }
      } catch (err) {
        if (signal.aborted) break;
        await new Promise(r => setTimeout(r, 4000));
      }
    }
  }

  // Start polling in background
  startTelegramPolling();

  // DSH Approval Hook: Allow approval from Telegram OR Web GUI (prepend to run before web remotes)
  ctx.on('approval/request', async (req, next) => {
    if (!botToken || !botChatId) return typeof next === 'function' ? next() : Promise.resolve('unavailable');

    const toolName = req.toolName || req.tool?.name || 'Thao tác';
    const reason = req.reason || 'Yêu cầu quyền thực thi';
    const session = req.agent?.session || getActiveSession();
    const project = getProjectName(session);

    const apprKey = `a_${Date.now()}_${++approvalCounter}`;
    const bridgeAbort = new AbortController();
    const origSignal = req.signal;
    req.signal = origSignal
      ? AbortSignal.any([origSignal, bridgeAbort.signal])
      : bridgeAbort.signal;

    tgSend(
      `⚠️ *Yêu cầu phê duyệt công cụ* [${project}]\n\n` +
      `• *Công cụ*: \`${toolName}\`\n` +
      `• *Lý do*: ${reason}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Cho phép', callback_data: `appr:allow:${apprKey}` },
              { text: '❌ Từ chối', callback_data: `appr:reject:${apprKey}` },
            ],
          ],
        },
      },
    );

    return new Promise((resolve) => {
      pendingApprovals.set(apprKey, {
        id: req.id,
        toolName,
        resolve: (outcome) => {
          bridgeAbort.abort(new Error('decided via telegram'));
          resolve(outcome);
        },
      });

      if (origSignal) {
        origSignal.addEventListener('abort', () => {
          if (pendingApprovals.has(apprKey)) {
            pendingApprovals.delete(apprKey);
            bridgeAbort.abort(origSignal.reason);
            resolve('cancelled');
          }
        }, { once: true });
      }

      if (typeof next === 'function') {
        Promise.resolve().then(next).then((outcome) => {
          if (outcome && outcome !== 'unavailable' && pendingApprovals.has(apprKey)) {
            pendingApprovals.delete(apprKey);
            bridgeAbort.abort(new Error('decided via web'));
            resolve(outcome);
          }
        }).catch(() => {
          // Ignore downstream rejection (e.g. no web client connected), keep waiting for Telegram
        });
      }
    });
  }, { prepend: true });

  // DSH Question Hook: Allow answering from Telegram (prepend to run before web remotes)
  ctx.on('user-questions/request', async (req, next) => {
    if (!botToken || !botChatId) return typeof next === 'function' ? next() : Promise.reject(new Error('no answerer'));

    const firstQ = req.questions?.[0];
    if (!firstQ) return typeof next === 'function' ? next() : Promise.reject(new Error('no question'));

    const session = req.agent?.session || getActiveSession();
    const project = getProjectName(session);
    const qKey = `q_${Date.now()}_${++questionCounter}`;

    const bridgeAbort = new AbortController();
    const origSignal = req.signal;
    req.signal = origSignal
      ? AbortSignal.any([origSignal, bridgeAbort.signal])
      : bridgeAbort.signal;

    const isPlanReview = firstQ.intent?.kind === 'plan-review';
    let textToSend = '';

    if (isPlanReview) {
      const planExcerpt = firstQ.detail ? `\n\n📖 *Kế hoạch thực hiện:*\n\`\`\`markdown\n${truncateLines(firstQ.detail, 2500)}\n\`\`\`` : '';
      textToSend = `📋 *Kế hoạch đã sẵn sàng (Plan Review)* [${project}]${planExcerpt}\n\n❓ *${firstQ.question}*`;
    } else {
      const headerPrefix = firstQ.header ? `*${firstQ.header}*: ` : '';
      const detailText = firstQ.detail ? `\n\n_${truncateLines(firstQ.detail, 1000)}_` : '';
      textToSend = `❓ *${headerPrefix}${firstQ.question}* [${project}]${detailText}\n\n_Bấm nút bên dưới hoặc gõ trực tiếp câu trả lời:_`;
    }

    const buttons = (firstQ.options || []).map((opt, idx) => {
      let label = opt.label;
      if (opt.label === 'Approve') label = '✅ Phê duyệt (Approve)';
      else if (opt.label === 'Keep planning') label = '🔄 Yêu cầu sửa lại (Keep planning)';
      return [{ text: label, callback_data: `ask:${qKey}:${idx}` }];
    });

    const replyMarkup = buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {};
    tgSend(textToSend, replyMarkup);

    return new Promise((resolve, reject) => {
      pendingQuestions.set(qKey, {
        resolve: (ans) => {
          bridgeAbort.abort(new Error('answered via telegram'));
          resolve(ans);
        },
        reject: (err) => {
          bridgeAbort.abort(err);
          reject(err);
        },
        questions: req.questions,
        qId: firstQ.id,
      });

      if (origSignal) {
        origSignal.addEventListener('abort', () => {
          if (pendingQuestions.has(qKey)) {
            pendingQuestions.delete(qKey);
            bridgeAbort.abort(origSignal.reason);
            reject(origSignal.reason);
          }
        }, { once: true });
      }

      if (typeof next === 'function') {
        Promise.resolve().then(next).then((outcome) => {
          if (outcome && pendingQuestions.has(qKey)) {
            pendingQuestions.delete(qKey);
            bridgeAbort.abort(new Error('answered via web'));
            resolve(outcome);
          }
        }).catch(() => {
          // Ignore downstream rejection (e.g. NO_PROVIDER from tail), keep waiting for Telegram!
        });
      }
    });
  }, { prepend: true });

  // Session Event Observer
  ctx.on('session/event', (session, event) => {
    // Ignore internal subagent turns and pre-seeded setup sessions
    if (session.header?.parentSession !== undefined || session.header?.isSeeded) return;

    const sid = session.id;
    lastActiveSessionId = sid;
    const state = getSessionState(sid);
    if (!state) return;

    const project = getProjectName(session);

    if (event.type === 'turn/start') {
      state.turnStartAt = event.time || Date.now();
      state.modifiedFiles.clear();
      state.toolCallsCount = 0;
      state.actionHistory = [];
      state.progressMsgId = null;

      // Start typing indicator loop
      if (botToken && botChatId) {
        tgSendChatAction('typing');
        if (state.typingTimer) clearInterval(state.typingTimer);
        state.typingTimer = setInterval(() => {
          tgSendChatAction('typing');
        }, 4500);

        // Send initial progress card
        const promptText = state.lastPrompt ? `📝 _"${truncate(state.lastPrompt, 70)}"_\n\n` : '';
        tgSend(
          `⚡ *DSH [${project}] đang xử lý...*\n` +
          promptText +
          `⏳ *Tiến trình:*\n• Đang phân tích yêu cầu...`,
        ).then((res) => {
          if (res?.ok && res.result?.message_id) {
            state.progressMsgId = res.result.message_id;
          }
        });
      }
    } else if (event.type === 'user/message') {
      let text = '';
      const content = event.data?.content;
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .map(c => (typeof c === 'string' ? c : c?.text || ''))
          .filter(Boolean)
          .join(' ');
      }
      if (text) state.lastPrompt = text;
    } else if (event.type === 'tool/call' && event.data) {
      state.toolCallsCount++;
      const toolName = event.data.name;

      let args = event.data.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch {}
      }

      // Check if deliverables presented
      if (toolName === 'present' && args?.files && Array.isArray(args.files)) {
        const cwd = session.header?.cwd || process.cwd();
        for (const f of args.files) {
          const fPath = f.path ? (isAbsolute(f.path) ? f.path : join(cwd, f.path)) : null;
          if (fPath && existsSync(fPath)) {
            tgSendDocument(fPath, `🎁 File bàn giao: ${f.description || basename(fPath)}`);
          }
        }
      }

      if (toolName === 'ask_user_question') {
        let qText = 'Agent đang cần câu trả lời của bạn.';
        if (args?.questions && Array.isArray(args.questions) && args.questions[0]?.question) {
          qText = args.questions[0].question;
        }
        if (soundEnabled) playSound('prompt', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Chờ bạn trả lời`,
            `"${truncate(qText, 90)}"`,
            'Câu hỏi từ Agent',
          );
        }
        return;
      }

      const fp = extractToolFilePath(toolName, args);
      if (fp && typeof fp === 'string') {
        state.modifiedFiles.add(basename(fp));
      }

      // Record in action history and update live progress card
      const desc = summarizeToolCall(toolName, args);
      state.actionHistory.push(desc);
      if (state.actionHistory.length > 5) {
        state.actionHistory.shift();
      }

      if (botToken && botChatId && state.progressMsgId) {
        const now = Date.now();
        const scheduleUpdate = () => {
          state.lastProgressUpdateAt = Date.now();
          const elapsed = formatDuration(state.lastProgressUpdateAt - state.turnStartAt);
          const promptText = state.lastPrompt ? `📝 _"${truncate(state.lastPrompt, 70)}"_\n\n` : '';
          const progressList = state.actionHistory.map((act, i) => {
            return i === state.actionHistory.length - 1 ? `▶ *${act}*...` : `✓ ${act}`;
          }).join('\n');

          tgEdit(
            botChatId,
            state.progressMsgId,
            `⚡ *DSH [${project}] đang xử lý...* (${elapsed})\n` +
            promptText +
            `⏳ *Tiến trình (${state.toolCallsCount} steps):*\n` +
            progressList,
          );
        };

        if (now - state.lastProgressUpdateAt >= 2000) {
          scheduleUpdate();
        } else if (!state.updateProgressTimer) {
          state.updateProgressTimer = setTimeout(() => {
            state.updateProgressTimer = null;
            scheduleUpdate();
          }, 2000 - (now - state.lastProgressUpdateAt));
        }
      }
    } else if (event.type === 'approval/asked' && event.data) {
      const tool = event.data.toolName || 'Thao tác';
      const reason = event.data.reason ? `Lý do: ${event.data.reason}` : 'Chờ bạn phê duyệt quyền thực thi';

      if (soundEnabled) playSound('prompt', volume, customSounds);
      if (notifyEnabled) {
        showNotification(
          `DSH [${project}] • Cần phê duyệt`,
          truncate(reason, 90),
          `Công cụ: ${tool}`,
        );
      }
    } else if (event.type === 'turn/end') {
      const duration = formatDuration(Math.max(100, (event.time || Date.now()) - state.turnStartAt));
      const reason = event.data?.reason;
      const kind = reason?.kind;
      const promptSnippet = state.lastPrompt ? `Yêu cầu: "${truncate(state.lastPrompt, 85)}"` : 'Tác vụ kết thúc.';

      // Stop typing and progress update timers
      if (state.typingTimer) {
        clearInterval(state.typingTimer);
        state.typingTimer = null;
      }
      if (state.updateProgressTimer) {
        clearTimeout(state.updateProgressTimer);
        state.updateProgressTimer = null;
      }

      // Extract assistant response text
      let assistantText = '';
      try {
        const events = session.snapshotEvents();
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i]?.type === 'assistant/message') {
            const content = events[i].data?.message?.content;
            if (Array.isArray(content)) {
              assistantText = content
                .filter(b => b && b.type === 'text')
                .map(b => b.text)
                .join('\n')
                .trim();
            }
            break;
          }
        }
      } catch {}

      if (kind === 'completed') {
        const fileCount = state.modifiedFiles.size;
        let subtitle = '';
        if (fileCount > 0) {
          const names = Array.from(state.modifiedFiles);
          subtitle = `Đã sửa ${fileCount} file: ${names.slice(0, 3).join(', ')}${fileCount > 3 ? '...' : ''}`;
        } else if (state.toolCallsCount > 0) {
          subtitle = `Đã hoàn tất (${state.toolCallsCount} lượt gọi công cụ)`;
        } else {
          subtitle = 'Đã hoàn tất câu trả lời';
        }

        // 1. Local sound & desktop notification
        if (soundEnabled) playSound('success', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Hoàn thành (${duration})`,
            promptSnippet,
            subtitle,
          );
        }

        // 2. Telegram: Update progress card and send Action Bar
        if (botToken && botChatId) {
          const fileLine = fileCount > 0 ? `📁 *File đã sửa:* ${Array.from(state.modifiedFiles).join(', ')}` : `⚡ Hoàn tất (${state.toolCallsCount} steps)`;
          const promptLine = state.lastPrompt ? `📝 _"${truncate(state.lastPrompt, 75)}"_\n` : '';

          if (state.progressMsgId) {
            tgEdit(
              botChatId,
              state.progressMsgId,
              `✅ *DSH [${project}] • Hoàn thành (${duration})*\n` +
              promptLine +
              fileLine,
            );
          }

          const actionMarkup = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📄 Xem Diff', callback_data: 'act:diff' },
                  { text: '📁 File đã sửa', callback_data: 'act:files' },
                ],
                [
                  { text: '🚀 Git Status', callback_data: 'act:gitstatus' },
                  { text: soundEnabled ? '🔇 Tắt loa' : '🔊 Bật loa', callback_data: soundEnabled ? 'act:mute' : 'act:unmute' },
                ],
                [
                  { text: '🔄 Session mới', callback_data: 'cmd:new' },
                ],
              ],
            },
          };

          // Send assistant response text (chunked if long)
          if (assistantText) {
            const chunks = splitMessage(assistantText);
            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              tgSend(chunks[i], isLast ? actionMarkup : {});
            }
          } else if (!state.progressMsgId) {
            tgSend(`✅ *DSH [${project}] • Hoàn thành (${duration})*\n${promptLine}${fileLine}`, actionMarkup);
          } else {
            tgSend(`🎉 *Lượt xử lý hoàn tất!* Bạn có thể xem kết quả hoặc chọn tác vụ nhanh:`, actionMarkup);
          }
        }
      } else if (kind === 'error') {
        const errMsg = reason?.error?.message || 'Có lỗi xảy ra khi thực thi.';
        const subtitle = `Lỗi: ${truncate(errMsg, 60)}`;
        const body = `${promptSnippet} (Dừng sau ${state.toolCallsCount} tool calls)`;

        if (soundEnabled) playSound('error', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Thất bại (${duration})`,
            body,
            subtitle,
          );
        }

        if (botToken && botChatId) {
          const errorMarkup = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📄 Xem Diff', callback_data: 'act:diff' },
                  { text: '🔄 Thử Session Mới', callback_data: 'cmd:new' },
                ],
              ],
            },
          };

          if (state.progressMsgId) {
            tgEdit(
              botChatId,
              state.progressMsgId,
              `❌ *DSH [${project}] • Thất bại (${duration})*\n\n` +
              `• *Lỗi*: ${errMsg}\n` +
              (state.lastPrompt ? `• *Yêu cầu*: _"${truncate(state.lastPrompt, 70)}"_\n` : '') +
              `• Dừng sau ${state.toolCallsCount} steps.`,
              errorMarkup,
            );
          } else {
            tgSend(
              `❌ *DSH [${project}] • Thất bại (${duration})*\n\n` +
              `• *Lỗi*: ${errMsg}\n` +
              (state.lastPrompt ? `• *Yêu cầu*: _"${truncate(state.lastPrompt, 70)}"_\n` : '') +
              `• Dừng sau ${state.toolCallsCount} steps.`,
              errorMarkup,
            );
          }
        }
      } else if (kind === 'aborted') {
        if (soundEnabled) playSound('interrupted', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Đã dừng (${duration})`,
            promptSnippet,
            'Người dùng hoặc hệ thống đã hủy tác vụ',
          );
        }

        if (botToken && botChatId) {
          if (state.progressMsgId) {
            tgEdit(botChatId, state.progressMsgId, `🛑 *DSH [${project}] • Đã dừng (${duration})*\n${promptSnippet}`);
          } else {
            tgSend(`🛑 *DSH [${project}] • Đã dừng (${duration})*\n${promptSnippet}`);
          }
        }
      } else if (kind === 'max-tokens') {
        if (soundEnabled) playSound('error', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Hết token (${duration})`,
            promptSnippet,
            'Đạt giới hạn context / output tokens',
          );
        }

        if (botToken && botChatId) {
          if (state.progressMsgId) {
            tgEdit(botChatId, state.progressMsgId, `⚠️ *DSH [${project}] • Hết token (${duration})*\n${promptSnippet}`);
          } else {
            tgSend(`⚠️ *DSH [${project}] • Hết token (${duration})*\n${promptSnippet}`);
          }
        }
      }
    }
  });

  // Clean up
  ctx.on('session/disposed', (session) => {
    if (session?.id) {
      sessionStates.delete(session.id);
      if (selectedSessionId === session.id) selectedSessionId = null;
      if (lastActiveSessionId === session.id) lastActiveSessionId = null;
    }
  });

  ctx.on('dispose', () => {
    abortController.abort();
  });

  console.info('[dsh-telegram-bridge] Active: Sounds + Desktop Notification + 2-way Telegram Bot (Vision, Voice, Shell, Files, Workspaces, Action Bar).');
}
