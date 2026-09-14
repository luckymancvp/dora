/**
 * Shim tương thích: bộ lọc thời gian đã chuyển sang components/ui/DateRangeFilter
 * để Board dùng chung (không fork, không copy). Giữ tên cũ cho caller chưa đổi import.
 * Code mới nên import trực tiếp `DateRangeFilter` từ "@/components/ui/DateRangeFilter".
 */
export { DateRangeFilter as DashboardDateFilter } from "@/components/ui/DateRangeFilter";
