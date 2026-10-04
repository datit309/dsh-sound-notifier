window.__ModuleLoader__.load({
  id: 'dsh-sound-notifier',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect } = React;

    function TelegramSettingsForm(props) {
      // If rendered in plugins.detail.section, only render for dsh-sound-notifier
      if (props?.subject !== undefined) {
        const subject = props.subject;
        const isMatching = (subject?.kind === 'bundle' && subject?.pkg?.name === 'dsh-sound-notifier') ||
                           (subject?.kind === 'row' && (subject?.row?.rowId === 'dsh-sound-notifier' || subject?.pkg?.name === 'dsh-sound-notifier'));
        if (!isMatching) return null;
      }

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
        return h('div', { style: { padding: '24px', color: '#888' } }, 'Đang tải cấu hình Telegram...');
      }

      return h('div', {
        style: {
          padding: '24px',
          maxWidth: '680px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          fontSize: '13px',
          color: 'var(--dsw-alias-label-primary, inherit)'
        }
      },
        // Header
        h('div', { style: { borderBottom: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.1))', paddingBottom: '14px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
            h('h2', { style: { margin: 0, fontSize: '18px', fontWeight: 600 } }, '🤖 Telegram Bot & Thông báo'),
            botInfo
              ? h('span', { style: { fontSize: '12px', color: '#10b981', background: 'rgba(16,185,129,0.12)', padding: '4px 10px', borderRadius: '6px', fontWeight: 500 } }, `🟢 @${botInfo.username}`)
              : h('span', { style: { fontSize: '12px', color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '4px 10px', borderRadius: '6px' } }, 'Chưa kết nối bot')
          ),
          h('p', { style: { margin: 0, fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #888)' } },
            'Điều khiển Agent từ điện thoại (nhắn prompt, gửi ảnh, chạy lệnh shell, git diff, duyệt tool) và phát âm thanh khi xong việc.'
          )
        ),
        // Field: Bot Token
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h('label', { style: { fontWeight: 600, fontSize: '13px' } }, 'Telegram Bot Token:'),
          h('div', { style: { display: 'flex', gap: '8px' } },
            h('input', {
              type: showToken ? 'text' : 'password',
              value: token,
              onChange: (e) => setToken(e.target.value),
              placeholder: '123456789:AAHDw3P1VKaD5NukdfMEmK23k...',
              style: {
                flex: 1,
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
                background: 'var(--dsw-alias-surface-input, rgba(0,0,0,0.15))',
                color: 'inherit',
                fontSize: '13px'
              }
            }),
            h('button', {
              type: 'button',
              onClick: () => setShowToken(!showToken),
              style: {
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: 'pointer',
                background: 'transparent',
                border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
                color: 'inherit',
                fontSize: '12px'
              }
            }, showToken ? 'Ẩn' : 'Hiện')
          ),
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #888)' } },
            'Token nhận được từ @BotFather khi tạo bot trên Telegram.'
          )
        ),
        // Field: Chat ID
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h('label', { style: { fontWeight: 600, fontSize: '13px' } }, 'Telegram Chat ID (Tài khoản của bạn):'),
          h('input', {
            type: 'text',
            value: chatId,
            onChange: (e) => setChatId(e.target.value),
            placeholder: 'Ví dụ: 557260074 (để trống và gửi /start vào bot để tự động điền)...',
            style: {
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
              background: 'var(--dsw-alias-surface-input, rgba(0,0,0,0.15))',
              color: 'inherit',
              fontSize: '13px'
            }
          }),
          h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #888)' } },
            'Chỉ tài khoản mang Chat ID này mới có quyền điều khiển Agent từ xa để bảo vệ an toàn.'
          )
        ),
        // Sound & Notification Toggles
        h('div', {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '14px',
            borderRadius: '8px',
            background: 'var(--dsw-alias-surface-raised, rgba(255,255,255,0.03))',
            border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.08))'
          }
        },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500 } },
            h('input', {
              type: 'checkbox',
              checked: sound,
              onChange: (e) => setSound(e.target.checked)
            }),
            '🔊 Phát âm thanh loa máy Mac (Hero / Basso)'
          ),
          h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 500 } },
            h('input', {
              type: 'checkbox',
              checked: notification,
              onChange: (e) => setNotification(e.target.checked)
            }),
            '🔔 Hiện banner thông báo trên màn hình macOS'
          )
        ),
        // Status Message
        statusMsg
          ? h('div', {
              style: {
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                background: statusMsg.startsWith('✅') || statusMsg.startsWith('🚀') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                color: statusMsg.startsWith('✅') || statusMsg.startsWith('🚀') ? '#10b981' : '#ef4444'
              }
            }, statusMsg)
          : null,
        // Action Buttons
        h('div', { style: { display: 'flex', gap: '12px', marginTop: '4px' } },
          h('button', {
            type: 'button',
            onClick: handleSave,
            disabled: saving,
            style: {
              padding: '9px 22px',
              borderRadius: '6px',
              cursor: saving ? 'not-allowed' : 'pointer',
              background: 'var(--dsw-alias-brand-primary, #2563eb)',
              color: '#fff',
              border: 'none',
              fontWeight: 600,
              fontSize: '13px'
            }
          }, saving ? 'Đang lưu...' : '💾 Lưu cấu hình'),
          h('button', {
            type: 'button',
            onClick: handleTest,
            disabled: !token || !chatId,
            style: {
              padding: '9px 18px',
              borderRadius: '6px',
              cursor: !token || !chatId ? 'not-allowed' : 'pointer',
              background: 'transparent',
              border: '1px solid var(--dsw-alias-border-subtle, rgba(255,255,255,0.2))',
              color: 'inherit',
              opacity: !token || !chatId ? 0.4 : 1,
              fontWeight: 500,
              fontSize: '13px'
            }
          }, '🚀 Gửi tin nhắn test Telegram')
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
          }, TelegramSettingsForm));
        }, 'dsh-sound-notifier: telegram section in settings modal');

        // 2. Also register into plugins detail page (sidebar panellist puzzle piece)
        ctx.effect(() => {
          return ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
            name: 'plugins.detail.section',
            id: 'dsh-sound-notifier-telegram-config',
            order: 10
          }, TelegramSettingsForm));
        }, 'dsh-sound-notifier: telegram config in plugins detail section');
      }
    };
  }
});
