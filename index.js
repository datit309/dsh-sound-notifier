import { execFile } from 'node:child_process';

export const name = 'dsh-sound-notifier';

// ponytail: Native OS afplay & AppleScript notifications; add browser WebAudio when remote clients needed.
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
    execFile('notify-send', [title, message], () => {});
  }
}

export function apply(ctx, config = {}) {
  const soundEnabled = config.sound !== false;
  const notifyEnabled = config.notification !== false;
  const volume = typeof config.volume === 'number' ? config.volume : 1;
  const customSounds = config.sounds || {};

  ctx.on('session/event', (session, event) => {
    // Ignore internal subagent turns and pre-seeded setup sessions
    if (session.header?.parentSession !== undefined || session.header?.isSeeded) return;

    if (event.type === 'turn/end') {
      const reason = event.data?.reason;
      const kind = reason?.kind;

      if (kind === 'completed') {
        if (soundEnabled) playSound('success', volume, customSounds);
        if (notifyEnabled) showNotification('DeepSeek Harness', 'Lượt xử lý đã hoàn thành!', 'Thành công');
      } else if (kind === 'error') {
        const errMsg = reason?.error?.message || 'Có lỗi xảy ra khi thực thi.';
        if (soundEnabled) playSound('error', volume, customSounds);
        if (notifyEnabled) showNotification('DeepSeek Harness', errMsg, 'Thất bại');
      } else if (kind === 'aborted') {
        if (soundEnabled) playSound('interrupted', volume, customSounds);
        if (notifyEnabled) showNotification('DeepSeek Harness', 'Tác vụ đã được dừng.', 'Đã dừng');
      } else if (kind === 'max-tokens') {
        if (soundEnabled) playSound('error', volume, customSounds);
        if (notifyEnabled) showNotification('DeepSeek Harness', 'Đạt giới hạn context / output tokens.', 'Cảnh báo');
      }
    } else if (event.type === 'approval/asked') {
      if (soundEnabled) playSound('prompt', volume, customSounds);
      if (notifyEnabled) showNotification('DeepSeek Harness', 'Agent cần bạn phê duyệt thao tác.', 'Chờ phê duyệt');
    } else if (event.type === 'tool/call' && event.data?.name === 'ask_user_question') {
      if (soundEnabled) playSound('prompt', volume, customSounds);
      if (notifyEnabled) showNotification('DeepSeek Harness', 'Agent đang đặt câu hỏi cho bạn.', 'Chờ trả lời');
    }
  });

  console.info('[dsh-sound-notifier] Sound notification plugin loaded.');
}
