# dsh-sound-notifier

Plugin đa năng cho DeepSeek Harness (DSH):
1. **Âm thanh hệ thống & Desktop Notifications** (macOS, Linux, Windows) khi agent hoàn thành công việc, gặp lỗi hoặc cần tương tác.
2. **Telegram 2-way Bot**: Tương tác 2 chiều hoàn chỉnh từ điện thoại:
   - Gửi ảnh chụp màn hình trực tiếp để Agent đọc ảnh (Vision).
   - Xem mã nguồn thay đổi thời gian thực (`/diff`).
   - Đổi Model AI ngay trên điện thoại (`/model`).
   - Nhận Live Progress Card cập nhật tiến trình từng bước.
   - Chọn và chuyển đổi Session chat (`/sessions`, `/switch`).
   - Phê duyệt (`approval/asked`) và trả lời câu hỏi (`ask_user_question`) bằng nút bấm inline.

---

## Tính năng chi tiết

### 1. Gửi ảnh từ điện thoại (Vision / Screenshot)
- Gửi ảnh trực tiếp từ app Telegram trên điện thoại kèm chú thích (caption).
- Bot tự động tải ảnh độ phân giải cao nhất về `~/.dsh/telegram-uploads/` và đính kèm vào prompt của Agent.
- Agent tự động dùng `read_image` hoặc multimodal vision để phân tích lỗi UI/terminal và fix code ngay.

### 2. Xem code thay đổi (`/diff`)
- Gõ `/diff` trên Telegram.
- Bot chạy `git status` và `git diff` trong workspace đang chọn, trả về:
  - Danh sách file thay đổi (staged / unstaged).
  - Thống kê diffstat (`+12 -3`).
  - Đoạn code diff highlight màu cú pháp rõ ràng.

### 3. Đổi Model AI từ xa (`/model`)
- Gõ `/model` để mở danh sách các model mạnh nhất:
  - ⚡ Gemini 3.8 Flash (High)
  - ⚡ Gemini 3.7 Flash (High)
  - 🧠 Claude 4.6 Sonnet
  - 🧠 Claude 4.6 Opus Thinking
  - 🚀 GPT-6 Astra
  - 🚀 GPT-5.6 Sol
  - 🌐 Qwen 3.7 Max
  - 🔄 Auto Router
- Bấm nút tương ứng trên điện thoại để áp dụng model ngay cho session hiện tại.

### 4. Quản lý Session (`/sessions`, `/switch`)
- `/sessions`: Xem danh sách tất cả các session đang mở kèm nút bấm chuyển đổi.
- `/switch <số>`: Đổi sang session cụ thể (ví dụ `/switch 1`).
- `/new`: Mở phiên làm việc (Session) mới từ xa.

### 5. Live Progress Card & Typing Indicator
- Khi Agent bắt đầu xử lý, bot gửi 1 tin nhắn tiến trình duy nhất và cập nhật liên tục:
  ```text
  ⚡ DSH [Freelancer] đang xử lý... (18s)
  📝 "Tích hợp tính năng 1, 2, 3"

  ⏳ Tiến trình (4 steps):
  ✓ Đọc `package.json`
  ✓ Chạy `git diff`
  ▶ Đang sửa `index.js`...
  ```
- Không gây spam thông báo, màn hình chat luôn gọn gàng.

### 6. Phê duyệt & Trả lời câu hỏi
- Tự động hiển thị nút bấm Inline `[ ✅ Cho phép ]` và `[ ❌ Từ chối ]` khi Agent gọi tool cần quyền.
- Hiển thị danh sách lựa chọn khi Agent gọi `ask_user_question`.

---

## Cấu hình

Tạo file `~/.dsh/telegram.json`:
```json
{
  "token": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID"
}
```
> **Mẹo tự động nhận `chatId`**: Nếu để trống `chatId`, bạn chỉ cần gửi tin nhắn `/start` tới bot từ điện thoại, bot sẽ tự lưu `chatId` của bạn và khóa quyền cho tài khoản đó.

---

## Bảng lệnh Telegram

| Lệnh | Chức năng |
|:--- |:--- |
| **Gõ tin nhắn bất kỳ** | Gửi prompt cho Agent lập trình |
| **Gửi ảnh kèm caption** | Đưa ảnh chụp màn hình cho Agent đọc và fix bug |
| `/diff` | Xem git diff mã nguồn vừa sửa đổi |
| `/model` | Mở menu đổi Model AI bằng nút bấm |
| `/sessions` | Xem danh sách & chọn Session chat |
| `/switch <số>` | Đổi nhanh sang session tương ứng |
| `/new` | Tạo session mới từ xa |
| `/status` | Xem trạng thái Agent, Session, Workspace |
| `/stop` | Dừng khẩn cấp lượt chạy |
| `/files` | Xem danh sách file vừa sửa |
| `/help` | Xem hướng dẫn sử dụng |

---

## License

MIT
