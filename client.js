window.__ModuleLoader__.load({
  id: 'dsh-telegram-bridge',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    // Scoped stylesheet: inline styles can't express :hover/:focus-visible/:disabled.
    // Colors come from host tokens; fallbacks mix currentColor so they work in light and dark.
    const CSS = `
.tgb { --tgb-line: var(--dsw-alias-border-subtle, color-mix(in srgb, currentColor 12%, transparent));
  --tgb-muted: var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 60%, transparent));
  --tgb-surface: var(--dsw-alias-surface-raised, color-mix(in srgb, currentColor 3%, transparent));
  --tgb-input: var(--dsw-alias-surface-input, color-mix(in srgb, currentColor 4%, transparent));
  --tgb-brand: var(--dsw-alias-brand-primary, #2563eb);
  --tgb-ok: #10b981; --tgb-warn: #f59e0b; --tgb-err: #ef4444;
  padding: 24px; max-width: 680px; display: flex; flex-direction: column; gap: 16px;
  font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary, inherit); }
.tgb * { box-sizing: border-box; }
.tgb-head { display: flex; align-items: flex-start; gap: 14px; }
.tgb-logo { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center;
  background: #229ED9; color: #fff; }
.tgb-title { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.tgb-sub { margin: 2px 0 0; font-size: 12px; color: var(--tgb-muted); }
.tgb-pill { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px;
  border-radius: 999px; font-size: 12px; font-weight: 500; border: 1px solid var(--tgb-line); white-space: nowrap; }
.tgb-dot { width: 7px; height: 7px; border-radius: 50%; }
.tgb-card { border: 1px solid var(--tgb-line); border-radius: 10px; background: var(--tgb-surface); }
.tgb-card-head { padding: 12px 16px; border-bottom: 1px solid var(--tgb-line); font-size: 11px; font-weight: 600;
  letter-spacing: 0.06em; text-transform: uppercase; color: var(--tgb-muted); }
.tgb-row { padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
.tgb-row + .tgb-row { border-top: 1px solid var(--tgb-line); }
.tgb-row-inline { flex-direction: row; align-items: center; justify-content: space-between; gap: 16px; }
.tgb-label { font-weight: 500; }
.tgb-hint { font-size: 12px; color: var(--tgb-muted); }
.tgb-field { position: relative; display: flex; }
.tgb-input { width: 100%; height: 34px; padding: 0 12px; border-radius: 7px; border: 1px solid var(--tgb-line);
  background: var(--tgb-input); color: inherit; font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px; outline: none; transition: border-color .15s, box-shadow .15s; }
.tgb-input::placeholder { color: var(--tgb-muted); opacity: .7; font-family: inherit; }
.tgb-input:focus { border-color: var(--tgb-brand); box-shadow: 0 0 0 3px color-mix(in srgb, var(--tgb-brand) 22%, transparent); }
.tgb-field .tgb-input { padding-right: 40px; }
.tgb-eye { position: absolute; right: 4px; top: 4px; width: 26px; height: 26px; border: 0; border-radius: 5px;
  background: transparent; color: var(--tgb-muted); cursor: pointer; display: grid; place-items: center; }
.tgb-eye:hover { color: inherit; background: var(--tgb-line); }
.tgb-switch { flex: none; position: relative; width: 36px; height: 20px; border-radius: 999px; border: 0; padding: 0;
  cursor: pointer; background: color-mix(in srgb, currentColor 22%, transparent); transition: background .15s; }
.tgb-switch[aria-checked="true"] { background: var(--tgb-brand); }
.tgb-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s; }
.tgb-switch[aria-checked="true"]::after { transform: translateX(16px); }
.tgb-range { display: flex; align-items: center; gap: 12px; }
.tgb-range input { flex: 1; accent-color: var(--tgb-brand); }
.tgb-range output { width: 40px; text-align: right; font-variant-numeric: tabular-nums; color: var(--tgb-muted); }
.tgb-disabled { opacity: .45; pointer-events: none; }
.tgb-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 4px; }
.tgb-status { margin-right: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--tgb-muted); }
.tgb-btn { height: 34px; padding: 0 16px; border-radius: 7px; font: inherit; font-weight: 500; cursor: pointer;
  display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--tgb-line); background: transparent;
  color: inherit; transition: background .15s, opacity .15s; }
.tgb-btn:hover:not(:disabled) { background: var(--tgb-line); }
.tgb-btn-primary { background: var(--tgb-brand); border-color: transparent; color: #fff; }
.tgb-btn-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--tgb-brand) 88%, #000); }
.tgb-btn:disabled { opacity: .45; cursor: not-allowed; }
.tgb-btn:focus-visible, .tgb-switch:focus-visible, .tgb-eye:focus-visible {
  outline: 2px solid var(--tgb-brand); outline-offset: 2px; }
.tgb-skel { height: 14px; border-radius: 4px; background: var(--tgb-line); animation: tgb-pulse 1.2s ease-in-out infinite; }
@keyframes tgb-pulse { 50% { opacity: .4; } }
@media (max-width: 520px) { .tgb { padding: 16px; } .tgb-head { flex-wrap: wrap; } .tgb-pill { margin-left: 54px; } }
`;

    const svg = (size, children, extra = {}) => h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra,
    }, ...children);
    const IconTelegram = () => h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
      h('path', { d: 'M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.3 13.1l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.5 2.9c.9-.3 1.6.2 1.4 1.4z' }));
    const IconEye = (open) => svg(15, open
      ? [h('path', { key: 1, d: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z' }), h('circle', { key: 2, cx: 12, cy: 12, r: 3 })]
      : [h('path', { key: 1, d: 'M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.1-5.9M9.9 5.2A9.1 9.1 0 0 1 12 5c6.5 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20' })]);
    const IconSend = () => svg(14, [h('path', { key: 1, d: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z' })]);
    const IconCheck = () => svg(14, [h('path', { key: 1, d: 'M20 6 9 17l-5-5' })]);
    const IconAlert = () => svg(14, [h('circle', { key: 1, cx: 12, cy: 12, r: 10 }), h('path', { key: 2, d: 'M12 8v4M12 16h.01' })]);

    function Switch({ checked, onChange, label }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        className: 'tgb-switch', onClick: () => onChange(!checked),
      });
    }

    function TelegramSettings(props) {
      // If rendered in plugins.detail.section, only render for dsh-telegram-bridge.
      // Kept outside the form so hooks below always run in the same order.
      if (props?.subject !== undefined) {
        const subject = props.subject;
        const isMatching = (subject?.kind === 'bundle' && subject?.pkg?.name === 'dsh-telegram-bridge') ||
                           (subject?.kind === 'row' && (subject?.row?.rowId === 'dsh-telegram-bridge' || subject?.pkg?.name === 'dsh-telegram-bridge'));
        if (!isMatching) return null;
      }
      return h(TelegramSettingsForm);
    }

    function TelegramSettingsForm() {
      const [form, setForm] = useState({ token: '', chatId: '', sound: true, notification: true, volume: 1 });
      const [saved, setSaved] = useState(form);
      const [showToken, setShowToken] = useState(false);
      const [botInfo, setBotInfo] = useState(null);
      const [status, setStatus] = useState(null); // { kind: 'ok' | 'err' | 'busy', text }
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);

      const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));
      const dirty = JSON.stringify(form) !== JSON.stringify(saved);
      const flash = (kind, text, ms) => {
        setStatus({ kind, text });
        if (ms) setTimeout(() => setStatus((s) => (s?.text === text ? null : s)), ms);
      };

      useEffect(() => {
        fetch('/api/dsh-telegram-bridge/config')
          .then(res => res.json())
          .then(data => {
            if (data.ok && data.config) {
              const next = {
                token: data.config.token || '',
                chatId: data.config.chatId || '',
                sound: data.config.sound !== false,
                notification: data.config.notification !== false,
                volume: typeof data.config.volume === 'number' ? data.config.volume : 1,
              };
              setForm(next);
              setSaved(next);
              setBotInfo(data.botInfo || null);
            }
          })
          .catch(e => console.warn('[dsh-telegram-bridge] fetch config error:', e))
          .finally(() => setLoading(false));
      }, []);

      const handleSave = async () => {
        setBusy(true);
        flash('busy', 'Đang lưu cấu hình…');
        try {
          const res = await fetch('/api/dsh-telegram-bridge/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          });
          const data = await res.json();
          if (data.ok) {
            setSaved(form);
            setBotInfo(data.botInfo || null);
            flash('ok', 'Đã lưu cấu hình', 3000);
          } else {
            flash('err', `Không lưu được: ${data.error || 'lỗi không xác định'}`);
          }
        } catch (e) {
          flash('err', `Lỗi kết nối: ${e.message}`);
        } finally {
          setBusy(false);
        }
      };

      const handleTest = async () => {
        setBusy(true);
        flash('busy', 'Đang gửi tin nhắn thử…');
        try {
          const res = await fetch('/api/dsh-telegram-bridge/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: form.token, chatId: form.chatId }),
          });
          const data = await res.json();
          if (data.ok) flash('ok', 'Đã gửi tin nhắn thử tới Telegram', 4000);
          else flash('err', `Gửi thất bại: ${data.error}`);
        } catch (e) {
          flash('err', `Lỗi kết nối: ${e.message}`);
        } finally {
          setBusy(false);
        }
      };

      const style = h('style', null, CSS);

      if (loading) {
        return h('div', { className: 'tgb', 'aria-busy': true }, style,
          h('div', { className: 'tgb-skel', style: { width: '40%' } }),
          h('div', { className: 'tgb-card', style: { height: 160 } }),
          h('div', { className: 'tgb-card', style: { height: 140 } }));
      }

      const canTest = form.token && form.chatId && !busy;
      const statusColor = { ok: 'var(--tgb-ok)', err: 'var(--tgb-err)', busy: 'var(--tgb-muted)' };

      return h('div', { className: 'tgb' }, style,
        // Header
        h('div', { className: 'tgb-head' },
          h('div', { className: 'tgb-logo' }, h(IconTelegram)),
          h('div', null,
            h('h2', { className: 'tgb-title' }, 'Telegram Bridge'),
            h('p', { className: 'tgb-sub' }, 'Điều khiển Agent từ điện thoại: gửi prompt, ảnh, lệnh shell, xem git diff, duyệt tool.')
          ),
          h('span', { className: 'tgb-pill', title: botInfo ? botInfo.first_name : 'Token trống hoặc không hợp lệ' },
            h('span', { className: 'tgb-dot', style: { background: botInfo ? 'var(--tgb-ok)' : 'var(--tgb-warn)' } }),
            botInfo ? `@${botInfo.username}` : 'Chưa kết nối')
        ),

        // Connection
        h('section', { className: 'tgb-card' },
          h('div', { className: 'tgb-card-head' }, 'Kết nối'),
          h('div', { className: 'tgb-row' },
            h('label', { className: 'tgb-label', htmlFor: 'tgb-token' }, 'Bot Token'),
            h('div', { className: 'tgb-field' },
              h('input', {
                id: 'tgb-token', className: 'tgb-input', type: showToken ? 'text' : 'password',
                value: form.token, onChange: (e) => set('token')(e.target.value),
                placeholder: '123456789:AAH…', autoComplete: 'off', spellCheck: false,
              }),
              h('button', {
                type: 'button', className: 'tgb-eye', onClick: () => setShowToken(!showToken),
                'aria-label': showToken ? 'Ẩn token' : 'Hiện token', title: showToken ? 'Ẩn token' : 'Hiện token',
              }, IconEye(!showToken))
            ),
            h('span', { className: 'tgb-hint' }, 'Lấy từ @BotFather khi tạo bot.')
          ),
          h('div', { className: 'tgb-row' },
            h('label', { className: 'tgb-label', htmlFor: 'tgb-chat' }, 'Chat ID'),
            h('input', {
              id: 'tgb-chat', className: 'tgb-input', type: 'text', inputMode: 'numeric',
              value: form.chatId, onChange: (e) => set('chatId')(e.target.value),
              placeholder: 'Để trống rồi gửi /start cho bot để tự điền', autoComplete: 'off',
            }),
            h('span', { className: 'tgb-hint' }, 'Chỉ tài khoản có Chat ID này mới được điều khiển Agent.')
          )
        ),

        // Local notifications
        h('section', { className: 'tgb-card' },
          h('div', { className: 'tgb-card-head' }, 'Thông báo trên máy'),
          h('div', { className: 'tgb-row tgb-row-inline' },
            h('div', null,
              h('div', { className: 'tgb-label' }, 'Âm thanh'),
              h('div', { className: 'tgb-hint' }, 'Phát âm thanh trên loa Mac khi Agent xong việc hoặc cần duyệt.')
            ),
            h(Switch, { checked: form.sound, onChange: set('sound'), label: 'Âm thanh' })
          ),
          h('div', { className: `tgb-row${form.sound ? '' : ' tgb-disabled'}` },
            h('label', { className: 'tgb-label', htmlFor: 'tgb-vol' }, 'Âm lượng'),
            h('div', { className: 'tgb-range' },
              h('input', {
                id: 'tgb-vol', type: 'range', min: 0, max: 1, step: 0.1, value: form.volume,
                onChange: (e) => set('volume')(Number(e.target.value)), disabled: !form.sound,
              }),
              h('output', { htmlFor: 'tgb-vol' }, `${Math.round(form.volume * 100)}%`)
            )
          ),
          h('div', { className: 'tgb-row tgb-row-inline' },
            h('div', null,
              h('div', { className: 'tgb-label' }, 'Banner macOS'),
              h('div', { className: 'tgb-hint' }, 'Hiện thông báo hệ thống trên màn hình.')
            ),
            h(Switch, { checked: form.notification, onChange: set('notification'), label: 'Banner macOS' })
          )
        ),

        // Footer
        h('div', { className: 'tgb-foot' },
          h('span', { className: 'tgb-status', role: 'status', 'aria-live': 'polite', style: { color: status ? statusColor[status.kind] : undefined } },
            status
              ? [status.kind === 'ok' ? h(IconCheck, { key: 'i' }) : status.kind === 'err' ? h(IconAlert, { key: 'i' }) : null, status.text]
              : dirty ? 'Có thay đổi chưa lưu' : null),
          h('button', {
            type: 'button', className: 'tgb-btn', onClick: handleTest, disabled: !canTest,
            title: canTest ? 'Gửi một tin nhắn thử bằng token và Chat ID ở trên' : 'Cần nhập Bot Token và Chat ID',
          }, h(IconSend), 'Gửi tin thử'),
          h('button', {
            type: 'button', className: 'tgb-btn tgb-btn-primary', onClick: handleSave, disabled: busy || !dirty,
          }, busy && status?.text.startsWith('Đang lưu') ? 'Đang lưu…' : 'Lưu cấu hình')
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 1. Register into Settings modal (sidebar bottom gear icon -> Telegram section)
        ctx.effect(() => {
          return ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'telegram',
            order: 25,
            label: () => 'Telegram & Notifier',
          }, TelegramSettings));
        }, 'dsh-telegram-bridge: telegram section in settings modal');

        // 2. Also register into plugins detail page (sidebar panellist puzzle piece)
        ctx.effect(() => {
          return ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
            name: 'plugins.detail.section',
            id: 'dsh-telegram-bridge-telegram-config',
            order: 10
          }, TelegramSettings));
        }, 'dsh-telegram-bridge: telegram config in plugins detail section');
      }
    };
  }
});
