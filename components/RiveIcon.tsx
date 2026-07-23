"use client";

import { useRive, useStateMachineInput } from "@rive-app/react-canvas";

/**
 * Wrapper hiển thị icon Rive (.riv) có tương tác.
 *
 * Cách dùng cơ bản (icon tự chạy):
 *   <RiveIcon src="/rive/demo.riv" size={64} />
 *
 * Cách dùng có hover (dành cho bộ "Interactive Icon Set"):
 *   <RiveIcon
 *     src="/rive/icons.riv"
 *     stateMachine="State Machine 1"  // tên state machine trong file .riv
 *     hoverInput="hover"              // tên boolean input bật khi rê chuột
 *     size={48}
 *   />
 *
 * Mở file .riv trong Rive editor để biết đúng tên state machine + input.
 */
export function RiveIcon({
  src,
  artboard,
  stateMachine,
  hoverInput,
  size = 64,
  className,
}: {
  src: string;
  /** Tên artboard cần hiển thị. Bỏ trống → artboard mặc định của file. */
  artboard?: string;
  /** Tên state machine. Bỏ trống → phát animation mặc định. */
  stateMachine?: string;
  /** Tên boolean input để bật/tắt khi hover. */
  hoverInput?: string;
  size?: number;
  className?: string;
}) {
  const { rive, RiveComponent } = useRive({
    src,
    artboard,
    stateMachines: stateMachine,
    autoplay: true,
  });

  // Chỉ lấy input khi có khai báo (hook luôn được gọi để giữ đúng thứ tự hook).
  const hover = useStateMachineInput(rive, stateMachine, hoverInput ?? "");

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      onMouseEnter={() => hover && (hover.value = true)}
      onMouseLeave={() => hover && (hover.value = false)}
    >
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
