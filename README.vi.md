# dsh-telegram-bridge

[English](README.md) | [Tiếng Việt](README.vi.md)

Plugin điều khiển từ xa 2 chiều qua Telegram, theo dõi tiến trình thời gian thực & Thông báo âm thanh toàn diện cho DeepSeek Harness (DSH).

Biến Telegram trên điện thoại thành trung tâm chỉ huy lập trình cho Agent trên máy Mac: gửi prompt, gửi voice, gửi ảnh màn hình lỗi, chạy lệnh terminal, tải file, xem git diff, đổi model, phê duyệt công cụ, và nhận tiến trình thời gian thực.

---

## Tính năng nổi bật

### 1. Tương tác & Lập trình từ xa qua Telegram
- 💬 **Prompting từ xa**: Gõ bất kỳ tin nhắn nào trong chat Telegram, Agent trên máy Mac sẽ nhận lệnh và thực thi ngay.
- 🎙 **Voice to Text**: Bấm giữ gửi Voice Message (`.ogg`), bot dùng Gemini AI chuyển giọng nói thành văn bản rồi nạp vào prompt cho Agent.
- 📷 **Vision / Screenshot**: Gửi ảnh chụp màn hình terminal hoặc lỗi giao diện kèm chú thích, Agent tự động phân tích ảnh và sửa code.
- 📁 **Document Upload**: Gửi file code/tài liệu (`.pdf`, `.txt`, `.sql`, `.js`, `.py`) từ điện thoại lên máy Mac để Agent đọc và xử lý.
- ⚡ **Live Progress Card**: Khi Agent chạy, bot cập nhật tiến trình từng bước thời gian thực (đọc file, sửa code, chạy lệnh) trong 1 tin nhắn duy nhất, không gây spam thông báo.
- 🔘 **Action Bar sau mỗi lượt**: Kết thúc lượt chạy, tin nhắn kết quả tự đính kèm các nút bấm 1-chạm (`[ 📄 Xem Diff ]`, `[ 📁 File đã sửa ]`, `[ 🚀 Git Status ]`, `[ 🔇 Tắt loa ]`, `[ 🔄 Session mới ]`).

### 2. Quản lý Mã nguồn & Hệ thống
- 📄 **Xem Git Diff (`/diff`)**: Hiển thị chi tiết các dòng code vừa thêm/bớt trong workspace đang chọn.
- 🚀 **Git Commit & Push (`/commit <message>`)**: Tự động `git add`, `git commit` và `git push` thẳng lên GitHub ngay từ điện thoại.
- 💻 **Chạy Shell trực tiếp (`/sh <lệnh>`)**: Thực thi lệnh terminal trực tiếp trên máy Mac (như `git status`, `pnpm test`, `docker ps`) và nhận kết quả ngay (0 token).
- 📥 **Tải File về điện thoại (`/get <file>`)**: Tải bất kỳ file nào từ máy Mac về Telegram với 1 chạm (trong `/files`) hoặc gõ lệnh `/get`.
- 🎁 **Tự động gửi file bàn giao**: Khi Agent gọi công cụ `present` bàn giao file kết quả, bot tự động gửi file đính kèm về Telegram.

### 3. Quản lý Session & Workspace
- 📋 **Chuyển đổi Session (`/sessions`, `/switch <số>`)**: Xem danh sách các phiên chat và chuyển đổi linh hoạt bằng nút bấm hoặc số thứ tự.
- 📂 **Chuyển đổi Workspace (`/workspaces`, `/cd <đường dẫn>`)**: Xem danh sách các thư mục dự án và chuyển thư mục làm việc của Agent.
- 🧠 **Đổi Model AI (`/model`)**: Chuyển đổi giữa các model mạnh nhất (Gemini 3.8 Flash, Claude 4.6 Sonnet, GPT-6 Astra, v.v.) bằng nút bấm.
- 🔄 **Tạo Session mới (`/new`)**: Mở phiên làm việc mới từ xa.

### 4. Phê duyệt & Bảo mật
- 🛡 **Nút bấm Phê duyệt (Approval)**: Khi Agent gọi công cụ cần quyền (`approval/asked`), bot hiển thị 2 nút `[ ✅ Cho phép ]` và `[ ❌ Từ chối ]`.
- ❓ **Trả lời Câu hỏi (User Questions)**: Khi Agent hỏi ý kiến (`ask_user_question`), bot hiển thị danh sách lựa chọn bằng nút bấm inline.
- 🔒 **Khóa Chat ID**: Chỉ tài khoản Telegram được ủy quyền mới có quyền điều khiển, người lạ nhắn sẽ bị từ chối 403.

### 5. Âm thanh & Desktop Notifications (Native OS)
- 🔊 **Âm thanh loa Mac**: Phát chuông `Hero.aiff` (hoàn thành), `Basso.aiff` (lỗi), `Ping.aiff` (cần tương tác) qua lệnh `afplay`.
- 🔔 **Banner macOS**: Đẩy thông báo kèm tiêu đề project, thời gian xử lý và danh sách file đã sửa.
- 🔇 **Bật/Tắt chuông từ xa (`/mute`, `/unmute`)**: Chuyển chế độ im lặng loa Mac khi cần yên tĩnh ban đêm.

---

## Bảng menu lệnh Telegram (Nút `[/]`)

| Lệnh | Chức năng |
|:--- |:--- |
| **Gửi Voice Message** | Tự động chuyển giọng nói thành văn bản và chạy prompt |
| **Gửi Ảnh + Caption** | Đưa ảnh chụp màn hình cho Agent đọc và fix bug |
| **Gửi File Tài liệu** | Gửi file đính kèm để Agent đọc và xử lý |
| `/diff` | Xem git diff mã nguồn vừa sửa đổi trong workspace |
| `/commit <msg>` | Commit & push git nhanh lên remote GitHub |
| `/sh <lệnh>` | Chạy lệnh terminal trực tiếp trên máy Mac (0 token) |
| `/get <file>` | Tải file từ máy Mac về điện thoại qua Telegram |
| `/files` | Xem danh sách file vừa sửa (kèm nút bấm tải 1-chạm) |
| `/workspaces` | Danh sách các thư mục dự án và nút bấm chuyển đổi |
| `/cd <đường dẫn>` | Chuyển thư mục làm việc của Agent |
| `/model` | Mở menu đổi Model AI bằng nút bấm |
| `/sessions` | Xem danh sách & chuyển đổi Session chat |
| `/switch <số>` | Đổi nhanh sang session tương ứng |
| `/mute` | Tắt âm thanh loa Mac (chỉ rung thông báo trên Telegram) |
| `/unmute` | Bật lại âm thanh loa Mac |
| `/new` | Mở phiên làm việc mới |
| `/status` | Xem trạng thái Agent, Session, Workspace, Loa Mac |
| `/stop` | Dừng khẩn cấp lượt chạy |
| `/help` | Xem hướng dẫn sử dụng chi tiết |

---

## Hướng dẫn cài đặt vào DSH

### Cách 1: Sử dụng DSH CLI (Khuyên dùng)

Chạy lệnh chuẩn `dsh plugin add` trong terminal của bạn:

```bash
# Cài đặt trực tiếp từ GitHub vào profile đang dùng (ví dụ: web)
dsh plugin --profile web add github:datit309/dsh-telegram-bridge
```

Hoặc cài đặt từ bản clone trên máy:

```bash
# Clone repository về máy
git clone https://github.com/datit309/dsh-telegram-bridge.git ~/dsh-telegram-bridge

# Cài đặt vào profile DSH
dsh plugin --profile web add ~/dsh-telegram-bridge
```

> Lệnh `dsh plugin add` sẽ tự động ghi dependency vào `~/.dsh/profiles/web/package.json` và kích hoạt bundle layer trong `dsh.profile.bundles`.

---

### Cách 2: Sử dụng giao diện DSH Web GUI

1. Mở DeepSeek Harness Web GUI (`http://127.0.0.1:3080`).
2. Bấm vào icon **Plugins (mảnh ghép)** ở thanh sidebar ngoài cùng bên trái.
3. Bấm nút **Thêm plugin (Add plugin)** ở góc trên bên phải.
4. Nhập đường dẫn GitHub:
   ```text
   github:datit309/dsh-telegram-bridge
   ```
5. Bấm **Cài đặt (Install)**. DSH sẽ tự động tải, đóng gói và kích hoạt plugin.

---

### Cách 3: Cài đặt thủ công (Dành cho nhà phát triển)

1. Thêm gói vào `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": {
    "dsh-telegram-bridge": "file:/path/to/dsh-telegram-bridge"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-telegram-bridge"
      ]
    }
  }
}
```

2. Tạo symlink vào `node_modules` (nếu phát triển cục bộ không qua pnpm install):
```bash
ln -sf /path/to/dsh-telegram-bridge ~/.dsh/profiles/web/node_modules/dsh-telegram-bridge
```

3. Bật plugin trong `~/.dsh/profiles/web/cordis.patch.yml`:
```yaml
- id: dsh-telegram-bridge
  name: "dsh-telegram-bridge"
```

---

## Cấu hình Bot

### Cách 1: File `~/.dsh/telegram.json` (Khuyên dùng)
Tạo hoặc chỉnh sửa file `~/.dsh/telegram.json`:
```json
{
  "token": "YOUR_TELEGRAM_BOT_TOKEN",
  "chatId": "YOUR_TELEGRAM_CHAT_ID"
}
```

> **Mẹo tự động nhận `chatId`**: Nếu để trống `chatId`, bạn chỉ cần gửi tin nhắn `/start` tới bot từ điện thoại, bot sẽ tự lưu `chatId` của bạn và khóa quyền cho tài khoản đó.

### Cách 2: Giao diện DSH Web GUI
Vào **Settings (icon bánh răng góc dưới bên trái) ➔ Telegram & Notifier**: Chỉnh sửa Token, Chat ID, công tắc bật/tắt âm thanh và bấm **Lưu cấu hình**.

### Cách 3: Biến môi trường
```bash
export TELEGRAM_BOT_TOKEN="YOUR_TELEGRAM_BOT_TOKEN"
export TELEGRAM_CHAT_ID="YOUR_TELEGRAM_CHAT_ID"
```

---

## Khởi động và sử dụng

Khởi động lại dịch vụ DSH:

```bash
# Nếu dsh web đang chạy, nhấn Ctrl+C để dừng, sau đó:
dsh web
```

Mở app Telegram trên điện thoại, tìm bot của bạn và gửi tin nhắn `/start`.

---

## License

MIT
