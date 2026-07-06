# dora-1 (messengerMeta)

Dashboard vận hành Messenger/Meta cho bán hàng Etsy. Stack: Next.js 16 (App Router) + React 19 + TypeScript, MongoDB native driver (đa DB: `meta_local` + `dora-master`), Google Sheets API, Ably (realtime), next-auth, TanStack Query, shadcn/Tailwind.

## Harness: Phát triển tính năng full-stack + QA nhất quán

**Mục tiêu:** Làm tính năng chạm cả backend lẫn frontend với hợp đồng kiểu chốt trước, và QA so khớp chéo ranh giới API↔UI để chặn bug lệch shape.

**Trigger:** Khi user yêu cầu thêm/sửa/hoàn thiện tính năng full-stack (endpoint + hook + UI, trang mới, luồng dữ liệu mới), hoặc kiểm tra nhất quán API↔UI → dùng skill `dora-feature-team`. Câu hỏi đơn thuần hoặc sửa 1 file lẻ không chạm ranh giới → làm trực tiếp.

**Mode:** Agent team (4 agent: feature-architect → backend-engineer + frontend-engineer song song → qa-integration). Mọi Agent gọi với `model: "opus"`.

**Lịch sử thay đổi:**
| Ngày | Thay đổi | Đối tượng | Sửa |
|------|----------|-----------|-----|
| 2026-07-06 | Khởi tạo harness | toàn bộ (4 agent + 4 skill) | - |
