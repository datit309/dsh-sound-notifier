# dsh-sound-notifier

Plugin thông báo âm thanh và desktop notification cho DeepSeek Harness (DSH) khi agent hoàn thành công việc, gặp lỗi hoặc cần người dùng tương tác.

## Tính năng

- **Thông báo hoàn thành**: Tự động phát âm thanh (`Hero.aiff` trên macOS) và đẩy notification khi agent hoàn tất lượt code.
- **Báo lỗi / hết token**: Âm thanh cảnh báo (`Basso.aiff`) kèm nội dung lỗi cụ thể khi có sự cố.
- **Nhắc phê duyệt / trả lời**: Phát chuông ping khi agent gọi `ask_user_question` hoặc chờ `approval/asked`.
- **Chạy trực tiếp native OS**: Gọi âm thanh hệ thống qua `afplay` (macOS), `paplay`/`aplay` (Linux) hoặc PowerShell (Windows). Không phụ thuộc vào tab trình duyệt, không bị chặn autoplay khi rời máy.
- **Tự động lọc subagent**: Chỉ phát chuông khi phiên chính của người dùng hoàn thành, bỏ qua các lượt subagent nội bộ.

## Cài đặt vào DSH

1. Clone hoặc cài đặt vào profile DSH:

```bash
cd ~/GIC/Freelancer/dsh-sound-notifier
```

2. Khai báo vào `~/.dsh/profiles/web/package.json`:

```json
{
  "dependencies": {
    "dsh-sound-notifier": "file:/path/to/dsh-sound-notifier"
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

3. Thêm cấu hình vào `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: dsh-sound-notifier
  name: "dsh-sound-notifier"
  config:
    sound: true
    notification: true
    volume: 1
```

## License

MIT
