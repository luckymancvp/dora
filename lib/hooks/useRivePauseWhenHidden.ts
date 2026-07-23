import { useEffect } from "react";
import type { Rive } from "@rive-app/react-canvas";

/**
 * Tạm dừng một instance Rive khi nó KHÔNG hiển thị để tiết kiệm CPU/GPU/pin:
 * - Cuộn ra ngoài viewport (IntersectionObserver).
 * - Chuyển sang tab trình duyệt khác (document visibilitychange).
 *
 * Chỉ vẽ khi vừa nằm trong tầm nhìn VỪA đang ở tab hiện hành. Quan trọng khi có
 * nhiều canvas Rive cùng lúc (vd lưới robocat ở Bảng xử lý).
 */
export function useRivePauseWhenHidden(rive: Rive | null, el: HTMLElement | null) {
  useEffect(() => {
    if (!rive || !el) return;

    let onScreen = true;
    let tabVisible = typeof document !== "undefined" ? !document.hidden : true;
    const apply = () => {
      if (onScreen && tabVisible) rive.play();
      else rive.pause();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        apply();
      },
      { threshold: 0 },
    );
    io.observe(el);

    const onVis = () => {
      tabVisible = !document.hidden;
      apply();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [rive, el]);
}
