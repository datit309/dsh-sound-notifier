import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import z from '@deepseek-ai/schemastery';

export const name = 'dsh-sound-notifier';
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

function formatDuration(ms) {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function getProjectName(session) {
  const cwd = session?.header?.cwd;
  if (!cwd) return 'DSH';
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.pop() || 'DSH';
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
    console.error('[dsh-sound-notifier] Failed to save telegram.json:', e.message);
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
  const soundEnabled = readVolatile(config.sound) !== false;
  const notifyEnabled = readVolatile(config.notification) !== false;
  const rawVol = readVolatile(config.volume);
  const volume = typeof rawVol === 'number' ? rawVol : 1;
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
        console.warn('[dsh-sound-notifier] Failed to resume agent:', e.message);
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

  const pendingApprovals = new Map(); // id -> resolve
  const pendingQuestions = new Map(); // callId -> { resolve, questions }

  const abortController = new AbortController();
  const signal = abortController.signal;

  async function tgSend(text, options = {}) {
    if (!botToken || !botChatId || !text) return null;
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
      console.warn('[dsh-sound-notifier] Telegram send error:', err.message);
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

  async function tgEdit(chatId, messageId, text, options = {}) {
    if (!botToken || !messageId) return null;
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

    // --- 1. Photo upload (Vision / Screenshot) ---
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

    if (!text) return;

    if (text === '/start' || text === '/help') {
      await tgSend(
        `🤖 *DeepSeek Harness Telegram Bot*\n` +
        `Đã kết nối với DSH trên máy Mac.\n\n` +
        `*Lệnh điều khiển:*\n` +
        `• /sessions - Xem danh sách & chọn Session chat\n` +
        `• /switch <số> - Đổi sang Session khác\n` +
        `• /model - Xem & đổi Model AI (Gemini, Claude, GPT)\n` +
        `• /diff - Xem chi tiết mã nguồn vừa sửa (Git Diff)\n` +
        `• /new - Mở một phiên làm việc mới\n` +
        `• /status - Xem chi tiết Session đang chọn\n` +
        `• /stop - Dừng khẩn cấp lượt chạy hiện tại\n` +
        `• /files - Xem danh sách file vừa được sửa\n` +
        `• /help - Xem hướng dẫn sử dụng\n\n` +
        `📷 *Gửi ảnh:* Gửi ảnh chụp màn hình trực tiếp để Agent đọc ảnh và fix bug.\n\n` +
        `💬 *Gửi prompt từ xa:* Gõ bất kỳ tin nhắn nào, Agent trong Session đang chọn sẽ thực thi ngay.`,
      );
      return;
    }

    // --- 2. Model selection (/model) ---
    if (text === '/model' || text === '/models') {
      await showModelSelectionMenu();
      return;
    }

    // --- 3. Git Diff (/diff) ---
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
        `• *Session đang chọn*: \`${session?.id || 'Không có'}\`\n` +
        `• *Model*: \`${currentModel}\`\n` +
        `• *Trạng thái*: ${statusText}\n` +
        `• *File vừa sửa*: ${fileCount} file\n` +
        (state?.lastPrompt ? `• *Prompt gần nhất*: _"${truncate(state.lastPrompt, 60)}"_\n` : '') +
        `\n_Lệnh: /sessions (đổi session), /model (đổi model), /diff (xem code sửa)._`,
      );
      return;
    }

    if (text === '/new') {
      try {
        if (typeof ctx.agents?.create === 'function') {
          const handle = await ctx.agents.create({ meta: { cwd: process.cwd() } });
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
        const list = Array.from(state.modifiedFiles).map(f => `• \`${f}\``).join('\n');
        await tgSend(`📁 *Các file đã sửa gần nhất:*\n${list}`);
      } else {
        await tgSend('ℹ️ Chưa có file nào được sửa đổi trong lượt gần nhất.');
      }
      return;
    }

    // Check if user is replying to a pending question
    if (pendingQuestions.size > 0) {
      const [latestCallId, item] = [...pendingQuestions.entries()].pop();
      pendingQuestions.delete(latestCallId);
      const qId = item.questions?.[0]?.id || 'question';
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
        console.warn('[dsh-sound-notifier] Auto-create agent failed:', e.message);
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
    await tgAnswerCallback(cq.id, 'Đã ghi nhận!');
    const data = cq.data || '';
    const chatId = cq.message.chat.id;
    const msgId = cq.message.message_id;

    if (data.startsWith('model:')) {
      const idx = Number.parseInt(data.replace('model:', ''), 10);
      const chosen = POPULAR_MODELS[idx];
      const session = getActiveSession();
      if (!session || !chosen) {
        await tgEdit(chatId, msgId, '❌ Không thể đổi model lúc này.');
        return;
      }
      try {
        session.append('model/selection', { provider: 'bee-router', model: chosen.id });
        const project = getProjectName(session);
        await tgEdit(
          chatId,
          msgId,
          `✅ *Đã đổi Model cho Session [${project}]:*\n• *Model mới*: \`${chosen.id}\` (${chosen.label})\nCác prompt tiếp theo sẽ chạy trên model này.`,
        );
      } catch (e) {
        await tgEdit(chatId, msgId, `❌ Lỗi khi đổi model: ${e.message}`);
      }
      return;
    }

    if (data.startsWith('switch:')) {
      const targetId = data.replace('switch:', '');
      const s = ctx.sessions?.get(targetId);
      if (s) {
        selectedSessionId = s.id;
        const summary = getSessionSummary(s);
        await tgEdit(
          chatId,
          msgId,
          `✅ *Đã chuyển sang session:*\n• *Project*: \`${summary.project}\`\n• *ID*: \`${s.id}\`\nMọi prompt bạn gửi tiếp theo sẽ chạy trong session này.`,
        );
      } else {
        await tgEdit(chatId, msgId, `❌ Session \`${targetId}\` không còn tồn tại.`);
      }
      return;
    }

    if (data === 'cmd:new') {
      try {
        if (typeof ctx.agents?.create === 'function') {
          const handle = await ctx.agents.create({ meta: { cwd: process.cwd() } });
          const newSession = handle?.agent?.session;
          if (newSession) {
            selectedSessionId = newSession.id;
            lastActiveSessionId = newSession.id;
            await tgEdit(
              chatId,
              msgId,
              `✨ *Đã tạo session mới*: \`${newSession.id}\`\n` +
              `• *Workspace*: \`${getProjectName(newSession)}\`\n` +
              `Đã tự động chọn session này làm active. Bạn có thể gửi prompt trực tiếp từ đây.`,
            );
            return;
          }
        }
        await tgEdit(chatId, msgId, '❌ Không thể khởi tạo session mới trên Host.');
      } catch (e) {
        await tgEdit(chatId, msgId, `❌ Lỗi tạo session: ${e.message}`);
      }
      return;
    }

    if (data.startsWith('appr:')) {
      const [, action, reqId] = data.split(':');
      const resolve = pendingApprovals.get(reqId);
      if (resolve) {
        pendingApprovals.delete(reqId);
        const approved = action === 'allow';
        resolve(approved ? 'allowed-once' : 'rejected');
        await tgEdit(
          chatId,
          msgId,
          approved
            ? '✅ *Đã cho phép thao tác (xác nhận từ Telegram)*'
            : '❌ *Đã từ chối thao tác (từ Telegram)*',
        );
      }
    } else if (data.startsWith('ask:')) {
      const [, callId, optIdxStr] = data.split(':');
      const item = pendingQuestions.get(callId);
      if (item) {
        pendingQuestions.delete(callId);
        const idx = Number.parseInt(optIdxStr, 10);
        const q = item.questions?.[0];
        const selectedLabel = q?.options?.[idx]?.label || 'Đồng ý';
        const qId = q?.id || 'question';
        item.resolve({
          answers: [{
            id: qId,
            selected: [selectedLabel],
          }],
        });
        await tgEdit(chatId, msgId, `☑️ *Đã chọn*: *${selectedLabel}*`);
      }
    }
  }

  // Long polling loop
  async function startTelegramPolling() {
    if (!botToken) {
      console.info('[dsh-sound-notifier] Telegram token not configured in ~/.dsh/telegram.json.');
      return;
    }

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const me = await meRes.json();
      if (!me.ok) {
        console.warn('[dsh-sound-notifier] Telegram bot token invalid:', me.description);
        return;
      }
      console.info(`[dsh-sound-notifier] Telegram Bot active: @${me.result.username}`);
      if (!botChatId) {
        console.info('[dsh-sound-notifier] Send /start to @' + me.result.username + ' to pair your Telegram chat.');
      }
    } catch (e) {
      console.warn('[dsh-sound-notifier] Telegram connection check failed:', e.message);
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

  // DSH Approval Hook: Allow approval from Telegram OR Web GUI
  ctx.on('approval/request', async (req, next) => {
    if (!botToken || !botChatId) return next();

    const toolName = req.toolName || req.tool?.name || 'Thao tác';
    const reason = req.reason || 'Yêu cầu quyền thực thi';
    const project = req.session ? getProjectName(req.session) : 'DSH';

    tgSend(
      `⚠️ *Yêu cầu phê duyệt công cụ*\n` +
      `• *Project*: \`${project}\`\n` +
      `• *Công cụ*: \`${toolName}\`\n` +
      `• *Lý do*: ${reason}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Cho phép', callback_data: `appr:allow:${req.id}` },
              { text: '❌ Từ chối', callback_data: `appr:reject:${req.id}` },
            ],
          ],
        },
      },
    );

    return new Promise((resolve) => {
      pendingApprovals.set(req.id, resolve);
      // Let Web GUI also decide if user acts there first
      next().then((outcome) => {
        if (pendingApprovals.has(req.id)) {
          pendingApprovals.delete(req.id);
          resolve(outcome);
        }
      });
    });
  });

  // DSH Question Hook: Allow answering from Telegram
  ctx.on('user-questions/request', async (req, next) => {
    if (!botToken || !botChatId) return typeof next === 'function' ? next() : undefined;

    const firstQ = req.questions?.[0];
    if (!firstQ) return typeof next === 'function' ? next() : undefined;

    const project = req.session ? getProjectName(req.session) : 'DSH';
    const buttons = (firstQ.options || []).map((opt, idx) => [
      { text: opt.label, callback_data: `ask:${req.callId}:${idx}` },
    ]);

    tgSend(
      `❓ *Câu hỏi từ Agent [${project}]*\n\n` +
      `"${firstQ.question}"\n\n` +
      (buttons.length > 0 ? '_Bấm nút bên dưới hoặc gõ trực tiếp câu trả lời:_' : '_Gõ câu trả lời của bạn vào đây:_'),
      buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : {},
    );

    return new Promise((resolve) => {
      pendingQuestions.set(req.callId, { resolve, questions: req.questions });
      if (typeof next === 'function') {
        next().then((outcome) => {
          if (pendingQuestions.has(req.callId)) {
            pendingQuestions.delete(req.callId);
            resolve(outcome);
          }
        });
      }
    });
  });

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

        // 2. Telegram: Update progress card to completed status
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

          // Send assistant response text (chunked if long)
          if (assistantText) {
            const chunks = splitMessage(assistantText);
            for (const chunk of chunks) {
              tgSend(chunk);
            }
          } else if (!state.progressMsgId) {
            tgSend(`✅ *DSH [${project}] • Hoàn thành (${duration})*\n${promptLine}${fileLine}`);
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
          if (state.progressMsgId) {
            tgEdit(
              botChatId,
              state.progressMsgId,
              `❌ *DSH [${project}] • Thất bại (${duration})*\n\n` +
              `• *Lỗi*: ${errMsg}\n` +
              (state.lastPrompt ? `• *Yêu cầu*: _"${truncate(state.lastPrompt, 70)}"_\n` : '') +
              `• Dừng sau ${state.toolCallsCount} steps.`,
            );
          } else {
            tgSend(
              `❌ *DSH [${project}] • Thất bại (${duration})*\n\n` +
              `• *Lỗi*: ${errMsg}\n` +
              (state.lastPrompt ? `• *Yêu cầu*: _"${truncate(state.lastPrompt, 70)}"_\n` : '') +
              `• Dừng sau ${state.toolCallsCount} steps.`,
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

  console.info('[dsh-sound-notifier] Active: Sounds + Desktop Notification + 2-way Telegram Bot + Vision + Diff + Model Switcher.');
}
