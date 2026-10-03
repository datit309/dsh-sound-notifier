# dsh-sound-notifier

Plugin đa năng cho DeepSeek Harness (DSH):
1. **Âm thanh hệ thống & Desktop Notifications** (macOS, Linux, Windows) khi agent hoàn thành công việc, gặp lỗi hoặc cần tương tác.
2. **Telegram 2-way Remote Control**: Điều khiển lập trình toàn diện 2 chiều từ điện thoại:
   - 🎙 **Voice to Text**: Gửi tin nhắn thoại Telegram để tự động chuyển thành prompt.
   - 📷 **Vision / Screenshot**: Gửi ảnh chụp màn hình để Agent đọc ảnh và fix bug.
   - 📁 **Document Upload**: Gửi file code/tài liệu (`.pdf`, `.txt`, `.sql`, `.js`) để Agent đọc và xử lý.
   - 📄 **Tải file (`/get <file>`)**: Tải file về điện thoại với 1 chạm hoặc gõ lệnh. Tự động gửi file khi Agent bàn giao (`present`).
   - 💻 **Chạy lệnh Shell (`/sh <lệnh>`)**: Chạy lệnh terminal trực tiếp trên máy Mac (0 token) và in kết quả về Telegram.
   - 🚀 **Git Commit & Push (`/commit <msg>`)**: Commit và push code thẳng lên GitHub ngay từ điện thoại.
   - 🔇 **Tắt / Bật chuông loa Mac (`/mute`, `/unmute`)**: Chuyển chế độ im lặng loa Mac từ xa khi cần yên tĩnh.
   - 📂 **Quản lý Workspace (`/workspaces`, `/cd <path>`)**: Xem danh sách các thư mục dự án và chuyển đổi thư mục làm việc.
   - 🔘 **Action Bar sau mỗi lượt**: Nút bấm thao tác nhanh (`[ 📄 Xem Diff ]`, `[ 📁 File đã sửa ]`, `[ 🚀 Git Status ]`, `[ 🔇 Tắt loa ]`, `[ 🔄 Session mới ]`).
   - 🧠 **Đổi Model AI (`/model`)**: Chuyển đổi linh hoạt giữa Gemini 3.8 Flash, Claude 4.6 Sonnet, GPT-6 Astra, v.v.
   - 📋 **Quản lý Session (`/sessions`, `/switch`, `/new`)**: Xem danh sách session và chuyển đổi phiên làm việc.
   - ⚡ **Live Progress Card**: Cập nhật tiến trình từng bước thời gian thực (không spam thông báo).
   - 🛡 **Phê duyệt & Hỏi đáp**: Phê duyệt quyền chạy tool (`approval`) và trả lời câu hỏi (`ask_user_question`) bằng nút bấm Inline.

---

## Bảng lệnh Telegram

| Lệnh | Chức năng |
|:--- |:--- |
| **Gửi Voice Message** | Tự động chuyển giọng nói thành văn bản và chạy prompt |
| **Gửi Ảnh + Caption** | Đưa ảnh chụp màn hình terminal/giao diện cho Agent đọc và sửa code |
| **Gửi File Tài liệu** | Gửi file đính kèm để Agent đọc và xử lý |
| `/diff` | Xem git diff mã nguồn vừa sửa đổi trong workspace |
| `/commit <msg>` | Commit & push git nhanh lên remote GitHub |
| `/sh <lệnh>` | Chạy lệnh terminal trực tiếp trên máy Mac (0 token) |
| `/get <file>` | Tải file từ máy Mac về điện thoại qua Telegram |
| `/files` | Xem danh sách file vừa sửa (kèm nút bấm tải 1-chạm) |
| `/mute` | Tắt âm thanh loa Mac (chỉ rung thông báo trên Telegram) |
| `/unmute` | Bật lại âm thanh loa Mac |
| `/workspaces` | Danh sách các thư mục dự án và nút bấm chuyển đổi |
| `/cd <đường dẫn>` | Chuyển thư mục làm việc của Agent |
| `/model` | Mở menu đổi Model AI bằng nút bấm |
| `/sessions` | Xem danh sách & chuyển đổi Session chat |
| `/switch <số>` | Đổi nhanh sang session tương ứng |
| `/new` | Mở phiên làm việc mới |
| `/status` | Xem trạng thái Agent, Session, Workspace, Loa Mac |
| `/stop` | Dừng khẩn cấp lượt chạy |
| `/help` | Xem hướng dẫn sử dụng chi tiết |

---

## Cấu hình

Tạo hoặc chỉnh sửa file `~/.dsh/telegram.json`:
```json
{
  "token": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID"
}
```

> **Mẹo tự động nhận `chatId`**: Nếu để trống `chatId`, bạn chỉ cần gửi tin nhắn `/start` tới bot từ điện thoại, bot sẽ tự lưu `chatId` của bạn và khóa quyền cho tài khoản đó.

Bạn cũng có thể cấu hình trực tiếp từ giao diện **DSH Web GUI**: Vào **Settings ➔ Plugins ➔ dsh-sound-notifier**.

---

## License

MIT
