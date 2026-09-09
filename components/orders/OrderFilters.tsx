"use client";

import { DESTINATION_OTHER } from "@/lib/types/etsy";
import type {
  OrderCompletedStatus,
  OrderCountryFacet,
  OrderDateRange,
  OrderDelivery,
  OrderFilters as Filters,
  OrderSort,
  ShopItem,
} from "@/lib/types/etsy";

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: "completed", label: "Date completed" },
  { value: "destination", label: "Destination" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

const DATE_OPTIONS: { value: OrderDateRange; label: string }[] = [
  { value: "all", label: "All" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "365d", label: "Last 365 days" },
];

const DELIVERY_OPTIONS: { value: OrderDelivery; label: string }[] = [
  { value: "all", label: "All" },
  { value: "refund", label: "Refund" },
  { value: "purchased", label: "Purchased" },
];

const STATUS_OPTIONS: { value: OrderCompletedStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pre-transit", label: "Pre-transit" },
  { value: "in-transit", label: "In transit" },
  { value: "delivered", label: "Delivered" },
  { value: "no-tracking", label: "No tracking" },
  { value: "cancelled", label: "Cancelled" },
  { value: "digital", label: "Digital" },
];

/** Nhóm có tiêu đề trong rail. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * Radio 1 dòng. Dùng input thật (không phải div giả) để giữ điều hướng bàn phím
 * và đọc màn hình — repo chưa có radio-group trong components/ui.
 */
function Radio<T extends string>({
  name,
  value,
  current,
  label,
  hint,
  onChange,
}: {
  name: string;
  value: T;
  current: T;
  label: string;
  hint?: string;
  onChange: (v: T) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <input
        type="radio"
        name={name}
        checked={current === value}
        onChange={() => onChange(value)}
        className="h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <span className={current === value ? "text-foreground" : undefined}>{label}</span>
      {hint ? <span className="ml-auto text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Check({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <span className={checked ? "text-foreground" : undefined}>{label}</span>
    </label>
  );
}

/**
 * Rail bộ lọc bên phải (mirror Etsy). Nhãn nhóm ngày/trạng thái đổi theo tab:
 * tab Completed lọc theo ngày HOÀN TẤT, tab New lọc theo ngày ĐẶT — khớp đúng
 * field mà service dùng (xem dateRangeClause trong orders-read.ts).
 */
export function OrderFilters({
  shops,
  countries,
  filters,
  onChange,
  onReset,
}: {
  shops: ShopItem[];
  countries: OrderCountryFacet[];
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onReset: () => void;
}) {
  const isCompleted = filters.tab === "Completed";

  return (
    <div className="space-y-5 rounded-2xl border border-border p-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Shop</h3>
        <select
          value={filters.shopName}
          onChange={(e) => onChange({ shopName: e.target.value })}
          className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Tất cả shop</option>
          {shops.map((s) => (
            <option key={s.userId} value={s.shopName}>
              {s.online ? "🟢" : "⚪"} {s.shopName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Sort by</h3>
        <select
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as OrderSort })}
          className="w-full rounded-xl border-0 bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <Group title={isCompleted ? "Completed date" : "Order date"}>
        {DATE_OPTIONS.map((o) => (
          <Radio
            key={o.value}
            name="dateRange"
            value={o.value}
            current={filters.dateRange}
            label={o.label}
            onChange={(v) => onChange({ dateRange: v })}
          />
        ))}
      </Group>

      <Group title="Delivery">
        {DELIVERY_OPTIONS.map((o) => (
          <Radio
            key={o.value}
            name="delivery"
            value={o.value}
            current={filters.delivery}
            label={o.label}
            onChange={(v) => onChange({ delivery: v })}
          />
        ))}
      </Group>

      <Group title={isCompleted ? "Completed status" : "Order status"}>
        {STATUS_OPTIONS.map((o) => (
          <Radio
            key={o.value}
            name="status"
            value={o.value}
            current={filters.status}
            label={o.label}
            onChange={(v) => onChange({ status: v })}
          />
        ))}
      </Group>

      <Group title="Destination">
        <Radio
          name="destination"
          value=""
          current={filters.destination}
          label="All"
          onChange={(v) => onChange({ destination: v })}
        />
        {/* Danh sách nước dựng từ facet dữ liệu thật, không hardcode như Etsy. */}
        {countries.map((c) => (
          <Radio
            key={c.country}
            name="destination"
            value={c.country}
            current={filters.destination}
            label={c.country}
            hint={String(c.count)}
            onChange={(v) => onChange({ destination: v })}
          />
        ))}
        {/* Chỉ có nghĩa khi facet đã bị cắt bớt — nếu liệt kê hết thì bucket này rỗng. */}
        <Radio
          name="destination"
          value={DESTINATION_OTHER}
          current={filters.destination}
          label="Everywhere else"
          onChange={(v) => onChange({ destination: v })}
        />
      </Group>

      <Group title="Order details">
        <Check
          checked={filters.hasNote}
          label="Has note from buyer"
          onChange={(v) => onChange({ hasNote: v })}
        />
        <Check
          checked={filters.isGift}
          label="Marked as gift"
          onChange={(v) => onChange({ isGift: v })}
        />
        <Check
          checked={filters.isPersonalized}
          label="Personalised"
          onChange={(v) => onChange({ isPersonalized: v })}
        />
      </Group>

      <button
        onClick={onReset}
        className="rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-secondary"
      >
        Reset filters
      </button>
    </div>
  );
}
