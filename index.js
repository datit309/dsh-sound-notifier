import { execFile } from 'node:child_process';
import { basename } from 'node:path';

export const name = 'dsh-sound-notifier';

// ponytail: Native OS audio & AppleScript desktop notifications; extend when web UI audio needed.
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

export function apply(ctx, config = {}) {
  const soundEnabled = config.sound !== false;
  const notifyEnabled = config.notification !== false;
  const volume = typeof config.volume === 'number' ? config.volume : 1;
  const customSounds = config.sounds || {};

  // Per-session tracking
  const sessionStates = new Map();

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

  ctx.on('session/event', (session, event) => {
    // Ignore internal subagent turns and pre-seeded setup sessions
    if (session.header?.parentSession !== undefined || session.header?.isSeeded) return;

    const sid = session.id;
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

      // Check if asking user question
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
            'Câu hỏi từ Agent'
          );
        }
        return;
      }

      // Track modified files
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
          `Công cụ: ${tool}`
        );
      }
    } else if (event.type === 'turn/end') {
      const duration = formatDuration(Math.max(100, (event.time || Date.now()) - state.turnStartAt));
      const reason = event.data?.reason;
      const kind = reason?.kind;
      const promptSnippet = state.lastPrompt ? `Yêu cầu: "${truncate(state.lastPrompt, 85)}"` : 'Tác vụ kết thúc.';

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

        if (soundEnabled) playSound('success', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Hoàn thành (${duration})`,
            promptSnippet,
            subtitle
          );
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
            subtitle
          );
        }
      } else if (kind === 'aborted') {
        if (soundEnabled) playSound('interrupted', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Đã dừng (${duration})`,
            promptSnippet,
            'Người dùng hoặc hệ thống đã hủy tác vụ'
          );
        }
      } else if (kind === 'max-tokens') {
        if (soundEnabled) playSound('error', volume, customSounds);
        if (notifyEnabled) {
          showNotification(
            `DSH [${project}] • Hết token (${duration})`,
            promptSnippet,
            'Đạt giới hạn context / output tokens'
          );
        }
      }
    }
  });

  // Clean up detached sessions
  ctx.on('session/disposed', (session) => {
    if (session?.id) sessionStates.delete(session.id);
  });

  console.info('[dsh-sound-notifier] Rich sound & desktop notification active.');
}
