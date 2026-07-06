---
name: dora-feature-team
description: Orchestrator điều phối agent team làm tính năng full-stack cho dora-1 (messengerMeta) — feature-architect → backend-engineer + frontend-engineer (song song) → qa-integration. Dùng skill này khi user yêu cầu THÊM/SỬA/HOÀN THIỆN một tính năng chạm cả backend lẫn frontend (vd trang mới, endpoint + hook + UI, luồng dữ liệu mới), hoặc yêu cầu kiểm tra tính nhất quán API↔UI. Cũng kích hoạt với các cụm: "làm tính năng", "thêm trang/màn hình", "thêm API + giao diện", "làm lại", "chạy lại", "cập nhật tính năng", "sửa/bổ sung phần ...", "QA lại", "kiểm tra khớp API với UI", "review nhất quán". KHÔNG dùng cho câu hỏi đơn thuần hoặc sửa 1 file lẻ không chạm ranh giới — khi đó làm trực tiếp.
---

# dora-feature-team — Orchestrator

Điều phối team 4 agent làm tính năng full-stack cho dora-1 theo mode **Agent team**. Mục tiêu: chốt hợp đồng kiểu trước, code backend/frontend song song, QA so khớp ranh giới tăng dần — tránh bug lệch shape API↔UI.

**Đọc trước:** convention nằm trong skill `dora-backend-patterns`, `dora-frontend-patterns`, `dora-integration-qa`. Agent tự đọc skill của mình; orchestrator không lặp lại nội dung đó.

## Team & mode

| Agent | Type | Vai trò | Skill |
|-------|------|---------|-------|
| feature-architect | opus | Chốt type contract + phân rã task | (điều phối) |
| backend-engineer | opus | service + route + collections | dora-backend-patterns |
| frontend-engineer | opus | hook + component | dora-frontend-patterns |
| qa-integration | opus (general-purpose) | so khớp chéo ranh giới | dora-integration-qa |

Mọi lời gọi `Agent` đặt `model: "opus"`. Data flow: **task-based** (điều phối) + **file-based** (`_workspace/`, sản phẩm) + **message-based** (realtime giữa agent).

## Phase 0 — Kiểm tra ngữ cảnh (khởi tạo / follow-up)

1. Kiểm `_workspace/` trong thư mục làm việc:
   - Không có → **chạy mới** (tạo `_workspace/`).
   - Có + user yêu cầu sửa một phần → **chạy lại một phần** (chỉ gọi lại agent liên quan, giữ file khác).
   - Có + user cấp input mới hoàn toàn → dời `_workspace/` cũ sang `_workspace_prev/`, chạy mới.
2. Xác định phạm vi: tính năng chạm backend, frontend, hay cả hai? Nếu chỉ một tầng vẫn giữ QA để so khớp với tầng còn lại đã có.

## Phase 1 — Kiến trúc (feature-architect)

1. `TeamCreate` team `dora-feature` gồm 4 thành viên trên.
2. Gọi `feature-architect` phân tích yêu cầu → ghi `_workspace/01_architect_contract.md` (type contract + task backend + task frontend + bảng seam) → `TaskCreate` các task với dependency.
3. Chờ contract xong trước khi mở code — đây là barrier bắt buộc.

## Phase 2 — Hiện thực song song (backend + frontend)

**Mode: agent team, song song.**
1. `backend-engineer` và `frontend-engineer` nhận contract, làm song song.
2. Giao tiếp realtime qua `SendMessage`: backend báo endpoint sẵn sàng (URL + param + type); frontend hỏi khi thiếu field. Không chờ nhau xong hẳn nếu contract đã đủ để bắt đầu.
3. Mỗi bên ghi `_workspace/02_backend_*.md` / `_workspace/03_frontend_*.md` và `TaskUpdate`.

## Phase 3 — QA tăng dần (qa-integration)

1. `qa-integration` chạy **ngay khi mỗi module báo xong** (không chờ cả hai), so khớp 4 tầng theo `dora-integration-qa`.
2. Kiểm chứng bằng `npm run build` / grep type / gọi thử endpoint.
3. Ghi `_workspace/04_qa_report.md`; gửi finding cho backend/frontend qua `SendMessage`. Backend/frontend sửa → QA kiểm lại seam đã đổi.
4. Lặp cho tới khi không còn finding mức "chặn merge".

## Phase 4 — Tổng kết

1. Orchestrator thu kết quả, báo user: tính năng đã làm, file thay đổi, finding QA còn tồn (nếu có), lệnh kiểm thử.
2. `TeamDelete` dọn team.
3. Hỏi feedback (Phase tiến hoá của harness): "Có phần nào muốn chỉnh về kết quả hoặc cách team phối hợp không?"

## Xử lý lỗi

- Agent lỗi/không phản hồi → retry 1 lần; thất bại tiếp → tiếp tục không có phần đó, ghi rõ thiếu trong tổng kết. Không bịa kết quả.
- Contract bất khả thi giữa chừng → architect điều chỉnh, thông báo cả backend+frontend để không lệch.
- Dữ liệu mâu thuẫn (nguồn field) → giữ, ghi kèm nguồn, không tự xoá.

## Kích thước team

4 thành viên cố định — phù hợp tính năng vừa (10–20 task). Nếu tính năng lớn hơn, tăng số task/agent thay vì thêm agent (3 agent tập trung > 5 agent phân tán).

## Test scenario

- **Luồng thường:** "Thêm trang Analytics theo shop" → architect chốt `AnalyticsResponse` trong `lib/types` → backend viết service+route đọc `meta_local`, frontend viết `useAnalytics`+component → QA phát hiện component đọc `item.revenue` nhưng projection thiếu → backend thêm field → build sạch → tổng kết.
- **Luồng lỗi:** backend báo dữ liệu nằm ở `dora-master` khác contract giả định `meta_local` → architect sửa contract, thông báo lại → frontend không đổi (type giữ nguyên) → QA xác nhận đúng DB.
