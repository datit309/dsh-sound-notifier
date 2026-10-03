import { execFile } from 'node:child_process';
import { basename, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const name = 'dsh-sound-notifier';
export const inject = ['sessions', 'agents'];

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

let lastSoundAt = 0;

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

  const token = config.token || config.telegram?.token || process.env.TELEGRAM_BOT_TOKEN || fileConfig.token || '';
  const chatId = config.chatId || config.telegram?.chatId || process.env.TELEGRAM_CHAT_ID || fileConfig.chatId || '';
  return { token: String(token).trim(), chatId: String(chatId).trim(), configFilePath };
}

function saveTelegramConfig(filePath, token, chatId) {
  try {
    writeFileSync(filePath, JSON.stringify({ token, chatId }, null, 2), 'utf8');
  } catch (e) {
    console.error('[dsh-sound-notifier] Failed to save telegram.json:', e.message);
  }
}

export function apply(ctx, config = {}) {
  const soundEnabled = config.sound !== false;
  const notifyEnabled = config.notification !== false;
  const volume = typeof config.volume === 'number' ? config.volume : 1;
  const customSounds = config.sounds || {};

  // Per-session tracking
  const sessionStates = new Map();
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
      };
      sessionStates.set(sid, s);
    }
    return s;
  }

  function getActiveSession() {
    if (lastActiveSessionId) {
      const s = ctx.sessions?.get(lastActiveSessionId);
      if (s) return s;
    }
    const list = ctx.sessions?.list?.() || [];
    return list[list.length - 1] || null;
  }

  function getActiveAgent(session) {
    if (!session) return null;
    return ctx.agents?.get(session.id) || null;
  }

  // --- Telegram Bot Engine ---
  const tgConfig = loadTelegramConfig(config);
  let botToken = tgConfig.token;
  let botChatId = tgConfig.chatId;
  const botConfigPath = tgConfig.configFilePath;

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
        // Fallback plain text if markdown entity fails
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

  async function tgEdit(chatId, messageId, text, options = {}) {
    if (!botToken) return;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
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
    } catch {}
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

    if (!text) return;

    if (text === '/start' || text === '/help') {
      await tgSend(
        `🤖 *DeepSeek Harness Telegram Bot*\n\n` +
        `*Lệnh điều khiển:*\n` +
        `• /status - Xem trạng thái Agent & Workspace\n` +
        `• /stop - Dừng khẩn cấp lượt chạy hiện tại\n` +
        `• /files - Xem danh sách file vừa được sửa\n` +
        `• /help - Xem lại hướng dẫn\n\n` +
        `💬 *Gửi prompt từ xa:*\n` +
        `Gõ bất kỳ tin nhắn nào vào đây, Agent trên máy Mac sẽ nhận lệnh và thực thi ngay.`,
      );
      return;
    }

    if (text === '/status') {
      const session = getActiveSession();
      const agent = getActiveAgent(session);
      const project = getProjectName(session);
      const state = session ? getSessionState(session.id) : null;
      const statusText = agent ? (agent.status === 'running' ? '⚡ Đang chạy (running)' : '💤 Đang rảnh (idle)') : 'Chưa có Agent';
      const fileCount = state?.modifiedFiles?.size || 0;

      await tgSend(
        `📊 *Trạng thái DeepSeek Harness*\n\n` +
        `• *Project*: \`${project}\`\n` +
        `• *Session*: \`${session?.id || 'Không có'}\`\n` +
        `• *Trạng thái*: ${statusText}\n` +
        `• *File vừa sửa*: ${fileCount} file\n` +
        (state?.lastPrompt ? `• *Prompt gần nhất*: _"${truncate(state.lastPrompt, 60)}"_` : ''),
      );
      return;
    }

    if (text === '/stop') {
      const session = getActiveSession();
      const agent = getActiveAgent(session);
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
    const session = getActiveSession();
    const agent = getActiveAgent(session);
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
      await tgSend(`⏳ *DSH [${project}]*: Agent đang bận. Đã xếp hàng prompt: _"${truncate(text, 60)}"_`);
    } else {
      await tgSend(`🚀 *DSH [${project}]*: Đã nhận yêu cầu: _"${truncate(text, 60)}"_\nAgent đang bắt đầu xử lý...`);
    }
  }

  // Handle Telegram button clicks (Inline Keyboard)
  async function handleTelegramCallback(cq) {
    await tgAnswerCallback(cq.id, 'Đã ghi nhận!');
    const data = cq.data || '';
    const chatId = cq.message.chat.id;
    const msgId = cq.message.message_id;

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

        // 2. Telegram message
        if (botToken && botChatId) {
          const header = `✅ *DSH [${project}] • Hoàn thành (${duration})*`;
          const promptLine = state.lastPrompt ? `📝 _"${truncate(state.lastPrompt, 80)}"_\n` : '';
          const fileLine = fileCount > 0 ? `📁 *File đã sửa:* ${Array.from(state.modifiedFiles).join(', ')}\n` : '';
          const bodyText = assistantText ? `\n${assistantText}` : '';
          const fullMessage = `${header}\n${promptLine}${fileLine}${bodyText}`.trim();

          const chunks = splitMessage(fullMessage);
          for (const chunk of chunks) {
            tgSend(chunk);
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
          tgSend(
            `❌ *DSH [${project}] • Thất bại (${duration})*\n\n` +
            `• *Lỗi*: ${errMsg}\n` +
            (state.lastPrompt ? `• *Yêu cầu*: _"${truncate(state.lastPrompt, 70)}"_\n` : '') +
            `• Dừng sau ${state.toolCallsCount} tool calls.`,
          );
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
          tgSend(`🛑 *DSH [${project}] • Đã dừng (${duration})*\n${promptSnippet}`);
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
          tgSend(`⚠️ *DSH [${project}] • Hết token (${duration})*\n${promptSnippet}`);
        }
      }
    }
  });

  // Clean up
  ctx.on('session/disposed', (session) => {
    if (session?.id) sessionStates.delete(session.id);
  });

  ctx.on('dispose', () => {
    abortController.abort();
  });

  console.info('[dsh-sound-notifier] Active: Sounds + Desktop Notification + 2-way Telegram Bot.');
}
