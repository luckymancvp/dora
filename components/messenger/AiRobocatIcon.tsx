"use client";

import { useEffect, useState } from "react";
import { useRive, useStateMachineInput } from "@rive-app/react-canvas";
import { useRivePauseWhenHidden } from "@/lib/hooks/useRivePauseWhenHidden";

const ARTBOARD = "Catbot";
const STATE_MACHINE = "State Machine";

/**
 * Robocat (mèo máy biểu cảm) dùng làm icon nút "Gợi ý AI".
 * File: public/rive/robocat.riv — CC BY 4.0, tác giả: setyosn.
 *
 * - Idle: mèo tự nhìn theo con trỏ (pointer listener dựng sẵn trong state machine).
 * - `active` (đang tạo gợi ý) → bật mặt "Chat".
 * - `error` → bật mặt "Error".
 */
export function AiRobocatIcon({
  active,
  error = false,
  size = 44,
}: {
  active: boolean;
  error?: boolean;
  size?: number;
}) {
  const { rive, RiveComponent } = useRive({
    src: "/rive/robocat.riv",
    artboard: ARTBOARD,
    stateMachines: STATE_MACHINE,
    autoplay: true,
  });

  const chat = useStateMachineInput(rive, STATE_MACHINE, "Chat");
  const err = useStateMachineInput(rive, STATE_MACHINE, "Error");

  // Đang tạo gợi ý → mặt Chat; xong → tắt (về idle).
  useEffect(() => {
    if (chat) chat.value = active && !error;
  }, [active, error, chat]);

  // Lỗi → mặt Error.
  useEffect(() => {
    if (err) err.value = error;
  }, [error, err]);

  // Tạm dừng vẽ khi khuất tầm nhìn / đổi tab (quan trọng khi có nhiều ô).
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useRivePauseWhenHidden(rive, el);

  return (
    <div ref={setEl} style={{ width: size, height: size }}>
      <RiveComponent style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
