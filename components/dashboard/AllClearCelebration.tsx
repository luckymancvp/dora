"use client";

import { useEffect, useRef, useState } from "react";
import { PartyPopper } from "lucide-react";

/**
 * Màn chúc mừng khi số tin "Chưa trả lời" về 0 (đã xử lý xong hết).
 *
 * - Bắn confetti bằng Canvas thuần (không phụ thuộc thư viện ngoài): mỗi mảnh
 *   giấy có trọng lực, lực cản, xoay và mờ dần → trông tự nhiên như confetti thật.
 * - Kèm overlay banner nổi lên giữa màn hình rồi tự biến mất sau ~4.5s.
 * - Chỉ kích hoạt khi `unread` CHUYỂN từ >0 xuống 0 (không bắn khi vừa tải trang
 *   mà đã sẵn = 0, tránh ăn mừng dữ liệu cũ). `ready` = đã có dữ liệu thật.
 * - Chỉ bắn trong khung giờ tan làm (16h–17h) và TỐI ĐA 1 lần/ngày
 *   (nhớ qua localStorage nên reload trang cũng không bắn lại).
 * - Tôn trọng prefers-reduced-motion: bỏ confetti, chỉ hiện banner nhẹ nhàng.
 */

// Khung giờ được phép ăn mừng (giờ địa phương). Đổi ở đây nếu muốn.
const CELEBRATE_START_HOUR = 16; // 16:00
const CELEBRATE_END_HOUR = 17; // đến trước 17:00
const STORAGE_PREFIX = "dora:celebrated:";

/** Khoá ngày hôm nay dạng YYYY-MM-DD theo giờ địa phương. */
function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Đủ điều kiện bắn: đang trong khung giờ & chưa bắn hôm nay. */
function canCelebrateNow(): boolean {
  if (typeof window === "undefined") return false;
  const hour = new Date().getHours();
  if (hour < CELEBRATE_START_HOUR || hour >= CELEBRATE_END_HOUR) return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + todayKey()) == null;
  } catch {
    return true; // localStorage bị chặn → cứ cho ăn mừng.
  }
}

/** Đánh dấu đã ăn mừng hôm nay. */
function markCelebratedToday(): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + todayKey(), "1");
  } catch {
    /* bỏ qua nếu localStorage không dùng được */
  }
}
export function AllClearCelebration({
  unread,
  ready,
}: {
  unread: number;
  ready: boolean;
}) {
  const [show, setShow] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevUnread = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Phát hiện thời điểm chuyển >0 → 0.
  useEffect(() => {
    if (!ready) return;
    const prev = prevUnread.current;
    if (prev != null && prev > 0 && unread === 0 && canCelebrateNow()) {
      markCelebratedToday();
      setShow(true);
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) fireConfetti(canvasRef.current);

      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setShow(false), 4500);
    }
    prevUnread.current = unread;
  }, [unread, ready]);

  // Dọn dẹp khi unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function fireConfetti(canvas: HTMLCanvasElement | null) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const colors = [
      "#0064e0", // primary blue
      "#2d88ff",
      "#31a24c", // success green
      "#45bd62",
      "#f2a918", // warning gold
      "#ffd54a",
      "#e41e3f", // red pop
      "#ff6b9d", // pink
    ];

    type P = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      w: number;
      h: number;
      color: string;
      rot: number;
      vrot: number;
      circle: boolean;
      life: number;
    };
    const parts: P[] = [];

    // 3 điểm bắn: góc trái-dưới, góc phải-dưới, và giữa-trên → phủ đầy màn hình.
    const cannons = [
      { x: W * 0.12, y: H + 10, angle: -Math.PI / 2.6, spread: 0.5, power: 22 },
      { x: W * 0.88, y: H + 10, angle: -Math.PI / 1.62, spread: 0.5, power: 22 },
      { x: W * 0.5, y: H * 0.22, angle: -Math.PI / 2, spread: Math.PI, power: 14 },
    ];

    const spawn = (n: number, c: (typeof cannons)[number]) => {
      for (let i = 0; i < n; i++) {
        const a = c.angle + (Math.random() - 0.5) * c.spread;
        const speed = c.power * (0.55 + Math.random() * 0.7);
        const circle = Math.random() < 0.35;
        const size = 6 + Math.random() * 6;
        parts.push({
          x: c.x,
          y: c.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          w: size,
          h: circle ? size : size * (0.4 + Math.random() * 0.5),
          color: colors[(Math.random() * colors.length) | 0],
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.4,
          circle,
          life: 0,
        });
      }
    };

    // Bắn thành nhiều đợt để hiệu ứng đầy đặn hơn.
    cannons.forEach((c) => spawn(90, c));
    const bursts = [180, 400].map((ms) =>
      setTimeout(() => cannons.forEach((c) => spawn(55, c)), ms),
    );

    const gravity = 0.32;
    const drag = 0.992;
    const maxLife = 260; // ~4.3s @60fps

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const p of parts) {
        if (p.life > maxLife) continue;
        alive++;
        p.life++;
        p.vx *= drag;
        p.vy = p.vy * drag + gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        // Mờ dần ở 1/3 cuối vòng đời.
        const fadeStart = maxLife * 0.66;
        const alpha =
          p.life < fadeStart ? 1 : Math.max(0, 1 - (p.life - fadeStart) / (maxLife - fadeStart));

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.circle) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }

      if (alive > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, W, H);
        bursts.forEach(clearTimeout);
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <>
      {/* Lớp canvas confetti phủ toàn màn hình, không chặn tương tác. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60] h-full w-full"
        style={{ display: show ? "block" : "none" }}
      />

      {/* Banner chúc mừng ở giữa màn hình. */}
      {show && (
        <div
          className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-4"
          role="status"
          aria-live="polite"
        >
          <div className="celebrate-pop flex flex-col items-center gap-3 rounded-3xl border border-success-soft bg-card/95 px-8 py-7 text-center shadow-2xl backdrop-blur-sm">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success-soft">
              <PartyPopper className="celebrate-wiggle h-9 w-9 text-success" />
            </span>
            <h2 className="bg-gradient-to-r from-success via-primary to-warning bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
              Xong hết rồi! 🎉
            </h2>
          </div>
        </div>
      )}
    </>
  );
}
