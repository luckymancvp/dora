/** Viết tắt tên (tối đa 2 ký tự) cho avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

let _decoderEl: HTMLTextAreaElement | null = null;

/** Decode HTML message của Etsy: <br> → xuống dòng, bỏ tag, giải mã entity (&#39; …). */
export function etsyText(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  if (typeof document !== "undefined") {
    _decoderEl = _decoderEl ?? document.createElement("textarea");
    _decoderEl.innerHTML = s;
    s = _decoderEl.value;
  }
  // Gom khoảng trắng thừa: chuẩn hoá xuống dòng, bỏ space cuối dòng và rút gọn
  // chuỗi dòng trống liên tiếp (nhiều <br>) còn tối đa 1 dòng trống — tránh bong bóng
  // tin nhắn bị cách quá nhiều dòng.
  s = s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

/**
 * Đổi URL ảnh Etsy sang bản gốc: il_<W>x<H>. → il_fullxfull.
 * Tổng quát mọi kích thước (75x75, 170x135, 300x300…). Không match → trả nguyên.
 */
export function etsyFullResUrl(url: string): string {
  if (!url) return url;
  return url.replace(/il_\d+x\d+\./, "il_fullxfull.");
}

/** Thời gian tương đối (vừa xong / 5 phút trước / 3 giờ trước …) từ unix seconds. */
export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const diffMs = Date.now() - unixSeconds * 1000;
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;

  // Đếm theo ngày lịch (mốc nửa đêm local), không phải khối 24h trôi qua.
  const msgDate = new Date(unixSeconds * 1000);
  const startMsg = new Date(msgDate.getFullYear(), msgDate.getMonth(), msgDate.getDate());
  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = Math.round((startNow.getTime() - startMsg.getTime()) / 86400000);

  if (d < 7) return `${d} ngày trước`;
  return msgDate.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
  });
}

/** Format giờ/ngày từ unix seconds. */
export function formatTime(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}
