window.__ModuleLoader__.load({
  id: 'dsh-sound-notifier',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    function TelegramConfigSection(props) {
      const subject = props?.subject;
      const isMatching = (subject?.kind === 'bundle' && subject?.pkg?.name === 'dsh-sound-notifier') ||
                         (subject?.kind === 'row' && (subject?.row?.rowId === 'dsh-sound-notifier' || subject?.pkg?.name === 'dsh-sound-notifier'));

      if (!isMatching) return null;

      const [token, setToken] = useState('');
      const [chatId, setChatId] = useState('');
      const [sound, setSound] = useState(true);
      const [notification, setNotification] = useState(true);
      const [volume, setVolume] = useState(1);
      const [showToken, setShowToken] = useState(false);
      const [botInfo, setBotInfo] = useState(null);
      const [statusMsg, setStatusMsg] = useState('');
      const [loading, setLoading] = useState(true);
      const [saving, setSaving] = useState(false);

      useEffect(() => {
        fetch('/api/dsh-sound-notifier/config')
          .then(res => res.json())
          .then(data => {
            if (data.ok && data.config) {
              setToken(data.config.token || '');
              setChatId(data.config.chatId || '');
              setSound(data.config.sound !== false);
              setNotification(data.config.notification !== false);
              setVolume(typeof data.config.volume === 'number' ? data.config.volume : 1);
              setBotInfo(data.botInfo || null);
            }
          })
          .catch(e => console.warn('[dsh-sound-notifier] fetch config error:', e))
          .finally(() => setLoading(false));
      }, []);

      const handleSave = async () => {
        setSaving(true);
        setStatusMsg('Đang lưu cấu hình...');
        try {
          const res = await fetch('/api/dsh-sound-notifier/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chatId, sound, notification, volume }),
          });
          const data = await res.json();
          if (data.ok) {
            setStatusMsg('✅ Đã lưu cấu hình thành công!');
            setBotInfo(data.botInfo || null);
            setTimeout(() => setStatusMsg(''), 3000);
          } else {
            setStatusMsg(`❌ Lỗi: ${data.error || 'Không lưu được'}`);
          }
        } catch (e) {
          setStatusMsg(`❌ Lỗi kết nối: ${e.message}`);
        } finally {
          setSaving(false);
        }
      };

      const handleTest = async () => {
        setStatusMsg('Đang gửi tin nhắn kiểm tra...');
        try {
          const res = await fetch('/api/dsh-sound-notifier/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, chatId }),
          });
          const data = await res.json();
          if (data.ok) {
            setStatusMsg('🚀 Đã gửi tin nhắn test thành công tới Telegram!');
            setTimeout(() => setStatusMsg(''), 4000);
          } else {
            setStatusMsg(`❌ Lỗi test: ${data.error}`);
          }
        } catch (e) {
          setStatusMsg(`❌ Lỗi: ${e.message}`);
        }
      };

      if (loading) {
        return h('div', { style: { padding: '16px', color: '#888' } }, 'Đang nạp cấu hình Telegram...');
      }

      return h('div', {
        style: {
          marginTop: '16px',
          padding: '18px 20px',
          borderRadius: '8px',
          border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.12))',
          background: 'var(--dsw-alias-surface-raised, rgba(255,255,255,0.03))',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          fontSize: '13px'
        }
      },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('h4', { style: { margin: 0, fontSize: '14px', fontWeight: 600 } }, '🤖 Cấu hình Telegram & Thông báo'),
          botInfo ? h('span', { style: { fontSize: '11px', color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '3px 8px', borderRadius: '4px', fontWeight: 500 } }, `🟢 @${botInfo.username}`) : h('span', { style: { fontSize: '11px', color: '#f59e0b' } }, 'Chưa kết nối bot')
        ),
        // Field: Bot Token
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('label', { style: { fontWeight: 500 } }, 'Telegram Bot Token (lấy từ @BotFather):'),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('input', {
              type: showToken ? 'text' : 'password',
              value: token,
              onChange: (e) => setToken(e.target.value),
              placeholder: '123456789:AAHDw3P1VKaD5NukdfMEmK23k...',
              style: {
                flex: 1,
                padding: '7px 10px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
                background: 'var(--dsw-alias-surface-input, rgba(0,0,0,0.2))',
                color: 'inherit',
                fontSize: '13px'
              }
            }),
            h('button', {
              type: 'button',
              onClick: () => setShowToken(!showToken),
              style: {
                padding: '4px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
                color: 'inherit',
                fontSize: '12px'
              }
            }, showToken ? 'Ẩn' : 'Hiện')
          )
        ),
        // Field: Chat ID
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('label', { style: { fontWeight: 500 } }, 'Telegram Chat ID:'),
          h('input', {
            type: 'text',
            value: chatId,
            onChange: (e) => setChatId(e.target.value),
            placeholder: 'Ví dụ: 557260074 (hoặc để trống để tự pair qua /start)...',
            style: {
              padding: '7px 10px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
              background: 'var(--dsw-alias-surface-input, rgba(0,0,0,0.2))',
              color: 'inherit',
              fontSize: '13px'
            }
          })
        ),
        // Toggles
        h('div', { style: { display: 'flex', gap: '24px', alignItems: 'center' } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: sound,
              onChange: (e) => setSound(e.target.checked)
            }),
            'Phát âm thanh loa Mac (Hero / Basso)'
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
            h('input', {
              type: 'checkbox',
              checked: notification,
              onChange: (e) => setNotification(e.target.checked)
            }),
            'Hiện banner thông báo macOS'
          )
        ),
        // Status Message
        statusMsg ? h('div', { style: { fontSize: '12px', fontWeight: 500, color: statusMsg.startsWith('✅') || statusMsg.startsWith('🚀') ? '#10b981' : '#f59e0b' } }, statusMsg) : null,
        // Action Buttons
        h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px' } },
          h('button', {
            type: 'button',
            onClick: handleSave,
            disabled: saving,
            style: {
              padding: '7px 18px',
              borderRadius: '6px',
              cursor: 'pointer',
              background: 'var(--dsw-alias-brand-primary, #2563eb)',
              color: '#fff',
              border: 'none',
              fontWeight: 500,
              fontSize: '13px'
            }
          }, saving ? 'Đang lưu...' : '💾 Lưu cấu hình'),
          h('button', {
            type: 'button',
            onClick: handleTest,
            disabled: !token || !chatId,
            style: {
              padding: '7px 14px',
              borderRadius: '6px',
              cursor: !token || !chatId ? 'not-allowed' : 'pointer',
              background: 'transparent',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
              color: 'inherit',
              opacity: !token || !chatId ? 0.5 : 1,
              fontSize: '13px'
            }
          }, '🚀 Gửi tin nhắn kiểm tra')
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          return ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
            name: 'plugins.detail.section',
            id: 'dsh-sound-notifier-telegram-config',
            order: 10
          }, TelegramConfigSection));
        }, 'dsh-sound-notifier: telegram config in plugins detail section');
      }
    };
  }
});
