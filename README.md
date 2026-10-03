# dsh-sound-notifier

Plugin đa năng cho DeepSeek Harness (DSH):
1. **Âm thanh hệ thống & Desktop Notifications** (macOS, Linux, Windows) khi agent hoàn thành công việc, gặp lỗi hoặc cần tương tác.
2. **Telegram 2-way Bot**: Nhận thông báo kết quả chi tiết, điều khiển Agent bằng prompt từ xa, phê duyệt (`approval/asked`) và trả lời câu hỏi (`ask_user_question`) bằng nút bấm trên điện thoại.

---

## Tính năng

### 1. Thông báo âm thanh & Desktop (Native OS)
- **Hoàn thành**: Phát chuông `Hero.aiff` + banner thông báo kèm thời gian xử lý và file đã sửa.
- **Báo lỗi / hết token**: Âm thanh `Basso.aiff` + nội dung lỗi chi tiết.
- **Cần phê duyệt / câu hỏi**: Âm thanh `Ping.aiff` + nhắc người dùng thao tác.

### 2. Telegram 2-way Bot (Tương tác 2 chiều từ điện thoại)
- **Tự động gửi kết quả**: Khi agent làm xong, bot gửi trực tiếp câu trả lời của AI kèm danh sách file đã thay đổi về Telegram.
- **Gửi prompt từ xa**: Gõ bất kỳ tin nhắn nào trong chat Telegram, Agent trên máy Mac sẽ nhận lệnh và thực thi.
- **Nút bấm phê duyệt trực tiếp**: Khi Agent gọi tool cần cấp quyền, bot gửi tin nhắn kèm 2 nút `[ ✅ Cho phép ]` và `[ ❌ Từ chối ]`. Bấm trực tiếp trên điện thoại để agent chạy tiếp.
- **Nút bấm trả lời câu hỏi**: Khi Agent hỏi (`ask_user_question`), bot hiển thị các lựa chọn bằng nút bấm inline.
- **Lệnh điều khiển**:
  - `/status`: Xem trạng thái Agent (running/idle), Session ID, Workspace đang mở.
  - `/stop`: Dừng khẩn cấp lượt chạy hiện tại (`agent.cancel()`).
  - `/files`: Xem danh sách file vừa chỉnh sửa gần nhất.
  - `/help`: Xem hướng dẫn sử dụng.
- **Bảo mật**: Tự động khóa theo `chat_id`, chỉ duy nhất tài khoản Telegram của bạn mới có quyền tương tác.

---

## Cấu hình

Bạn có thể cấu hình Telegram qua 1 trong 3 cách:

### Cách 1: File `~/.dsh/telegram.json` (Khuyên dùng)
Tạo file `~/.dsh/telegram.json`:
```json
{
  "token": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID"
}
```
> **Mẹo tự động nhận `chatId`**: Nếu để trống `chatId`, bạn chỉ cần gửi tin nhắn `/start` tới bot từ điện thoại, bot sẽ tự lưu `chatId` của bạn và khóa quyền cho tài khoản đó.

### Cách 2: `cordis.patch.yml` của DSH
Trong `~/.dsh/profiles/web/cordis.patch.yml`:
```yaml
- id: dsh-sound-notifier
  name: "dsh-sound-notifier"
  config:
    sound: true
    notification: true
    volume: 1
    telegram:
      token: "YOUR_TELEGRAM_BOT_TOKEN"
      chatId: "YOUR_TELEGRAM_CHAT_ID"
```

### Cách 3: Biến môi trường
```bash
export TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
export TELEGRAM_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
```

---

## Cài đặt vào DSH Profile

1. Khai báo vào `~/.dsh/profiles/web/package.json`:
```json
{
  "dependencies": {
    "dsh-sound-notifier": "file:/Users/trantandat/GIC/Freelancer/dsh-sound-notifier"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-sound-notifier"
      ]
    }
  }
}
```

2. Kích hoạt trong `~/.dsh/profiles/web/cordis.patch.yml`:
```yaml
- id: dsh-sound-notifier
  name: "dsh-sound-notifier"
```

---

## License

MIT
