"use client";

import { useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-canvas";
import { useRivePauseWhenHidden } from "@/lib/hooks/useRivePauseWhenHidden";

/**
 * Wrapper hiển thị icon Rive (.riv) có tương tác.
 *
 * Cách dùng cơ bản (phát 1 animation, tự lặp):
 *   <RiveIcon
 *     src="/rive/cat-playing.riv"
 *     artboard="Cat playing animation"
 *     animation="Cat playing animation"
 *     size={96}
 *   />
 *
 * Cách dùng có state machine + hover:
 *   <RiveIcon
 *     src="/rive/xxx.riv"
 *     stateMachine="State Machine 1"  // tên state machine trong file .riv
 *     hoverInput="hover"              // tên boolean input bật khi rê chuột
 *     size={48}
 *   />
 *
 * Mở file .riv trong Rive editor để biết đúng tên artboard/state machine/input.
 * Tự tạm dừng vẽ khi khuất tầm nhìn (xem useRivePauseWhenHidden).
 */
export function RiveIcon({
  src,
  artboard,
  stateMachine,
  animation,
  hoverInput,
  size = 64,
  className,
}: {
  src: string;
  /** Tên artboard cần hiển thị. Bỏ trống → artboard mặc định của file. */
  artboard?: string;
  /** Tên state machine. Bỏ trống → phát animation mặc định. */
  stateMachine?: string;
  /** Tên animation phát trực tiếp (khi artboard không có state machine). */
  animation?: string;
  /** Tên boolean input để bật/tắt khi hover. */
  hoverInput?: string;
  size?: number;
  className?: string;
}) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard,
    stateMachines: stateMachine,
    animations: animation,
    autoplay: true,
  });

  // Chỉ lấy input khi có khai báo (hook luôn được gọi để giữ đúng thứ tự hook).
  const hover = useStateMachineInput(rive, stateMachine, hoverInput ?? "");

  // Tạm dừng vẽ khi canvas khuất tầm nhìn / đổi tab.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useRivePauseWhenHidden(rive, el);

  return (
    <div
      ref={setEl}
      className={className}
      style={{ width: size, height: size }}
      onMouseEnter={() => hover && (hover.value = true)}
      onMouseLeave={() => hover && (hover.value = false)}
    >
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
