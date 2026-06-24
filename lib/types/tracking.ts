import type { ObjectId } from "mongodb";

/**
 * Tracking add lên Etsy qua extension (Ably). Một job = 1 shop + N đơn.
 * Luồng: PRECHECK (fetch-shipments) → AWAIT_CONFIRM → ADDING (send-tracking)
 * → VERIFY (fetch-shipments lần 2) → COMPLETED.
 */

export type TrackingPhase =
  | "PRECHECK"
  | "AWAIT_CONFIRM"
  | "ADDING"
  | "VERIFY"
  | "COMPLETED";

export type PrecheckState = "PENDING" | "CLEAR" | "EXISTS";
export type AddStatus = "NEW" | "SENDING" | "DONE" | "FAILED";
export type VerifyState = "PENDING" | "VERIFIED" | "MISMATCH" | "SKIPPED";

export interface TrackingValue {
  code: string;
  carrier_name: string;
}

export interface TrackingJobOrder {
  order_id: string;
  tracking_number: string;
  /** Etsy carrier id (-1 nếu dùng other_carrier). */
  carrier: number;
  other_carrier: string;
  precheck: PrecheckState;
  /** Tracking đã tồn tại trên Etsy lúc pre-check (khi precheck = EXISTS). */
  existing?: TrackingValue;
  /** Người dùng đã chọn đơn này để add (đơn EXISTS cần tick để override). */
  selected: boolean;
  add_status: AddStatus;
  verify: VerifyState;
  /** Tracking thực tế lấy lại sau khi add (bước verify). */
  verified?: TrackingValue;
  message?: string;
}

export interface TrackingJob {
  _id: ObjectId;
  shop_name: string;
  shop_id: number | null;
  /** clientId của browser extension được nhắm tới (presence). */
  client_id: string;
  sender_email: string;
  phase: TrackingPhase;
  orders: TrackingJobOrder[];
  /** Lỗi từ extension khi GET shipments (vd shop_id sai). Set thì FE báo lỗi, không coi là CLEAR. */
  error?: string;
  created_at: Date;
  updated_at: Date;
}

/** Input mỗi dòng từ UI trước khi map carrier. */
export interface TrackingOrderInput {
  order_id: string;
  tracking_number: string;
  /** Tên carrier người dùng nhập (vd "Royal Mail"). */
  carrier: string;
}

/** Shipment đã normalize do extension trả về (snake_case). */
export interface ShipmentResultItem {
  order_id: string;
  tracking_code: string;
  carrier_name: string;
  tracking_url?: string;
  is_shipped?: boolean;
  is_delivered?: boolean;
}

/**
 * Carrier Etsy phổ biến (theo Meta-extension/docs/tracking-api.md).
 * id -1 = Other (kèm other_carrier).
 */
export const CARRIERS: { id: number; name: string; aliases?: string[] }[] = [
  { id: 1, name: "USPS" },
  { id: 2, name: "FedEx" },
  { id: 3, name: "UPS" },
  { id: 4, name: "DHL" },
  { id: 5, name: "Canada Post" },
  { id: 6, name: "Australia Post", aliases: ["AusPost"] },
  { id: 7, name: "Royal Mail" },
  { id: 8, name: "Deutsche Post", aliases: ["DHL Deutsche Post"] },
  { id: 9, name: "La Poste" },
  { id: 10, name: "Japan Post" },
];

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Tên carrier để hiển thị: known id → tên chuẩn; -1 → other_carrier (nếu có). */
export function carrierLabel(carrier: number, other_carrier: string): string {
  if (carrier === -1) return other_carrier.trim();
  return CARRIERS.find((c) => c.id === carrier)?.name ?? other_carrier.trim();
}

/**
 * Map tên carrier người dùng nhập sang { carrier, other_carrier }.
 * Khớp tên/alias known → carrier id, other_carrier rỗng.
 * Không khớp → carrier = -1, other_carrier = tên gốc (Etsy "Other").
 */
export function resolveCarrier(input: string): { carrier: number; other_carrier: string } {
  const n = norm(input);
  if (!n) return { carrier: -1, other_carrier: "" };
  for (const c of CARRIERS) {
    if (norm(c.name) === n) return { carrier: c.id, other_carrier: "" };
    if (c.aliases?.some((a) => norm(a) === n)) return { carrier: c.id, other_carrier: "" };
  }
  return { carrier: -1, other_carrier: input.trim() };
}
