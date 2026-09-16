"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFY_LABEL = exports.VERIFY_FAILURE_STATES = void 0;
exports.isVerifyFailure = isVerifyFailure;
exports.summarizeTrackingOrders = summarizeTrackingOrders;
exports.carrierLabel = carrierLabel;
exports.resolveCarrier = resolveCarrier;
/**
 * Các VerifyState tính là "đơn có vấn đề sau khi add" (đã add nhưng không đạt
 * xác minh). Dùng chung cho đếm counts và tô màu ở UI — thêm state mới CHỈ cần
 * thêm vào đây, mọi nơi tự cập nhật.
 */
exports.VERIFY_FAILURE_STATES = [
    "NOT_FOUND",
    "CODE_MISMATCH",
    "CARRIER_MISMATCH",
    "NOT_SHIPPED",
    "MISMATCH",
];
/** Đơn đã add nhưng xác minh KHÔNG đạt (gồm cả giá trị legacy MISMATCH). */
function isVerifyFailure(v) {
    return exports.VERIFY_FAILURE_STATES.includes(v);
}
/** Nhãn ngắn hiển thị badge/cột trạng thái. Record đủ 8 giá trị → thêm state mới là lỗi compile. */
exports.VERIFY_LABEL = {
    PENDING: "Chờ xác minh",
    VERIFIED: "Đã add & xác minh",
    NOT_FOUND: "Không thấy tracking trên Etsy",
    CODE_MISMATCH: "Mã tracking lệch",
    CARRIER_MISMATCH: "Carrier lệch",
    NOT_SHIPPED: "Etsy chưa đánh dấu đã ship",
    MISMATCH: "Lệch tracking",
    SKIPPED: "Bỏ qua",
};
/**
 * NGUỒN DUY NHẤT tính TrackingJobCounts — hàm thuần, không đụng DB, nên CẢ HAI
 * phía dùng chung được:
 *   - backend: `summarizeJob` trong lib/services/tracking.ts (list lịch sử)
 *   - frontend: `JobCard.summary` trong app/tracking/page.tsx (job đang chạy)
 * Ràng buộc "logic phải khớp 1:1" trước đây chỉ là comment nên dễ trôi; giờ khớp
 * do dùng CHUNG hàm này. TUYỆT ĐỐI không copy lại logic đếm ở nơi khác.
 *
 * Lưu ý hiển thị: page.tsx in "Hoàn tất N đơn" với N = số đơn ĐÃ GỬI → dùng
 * `counts.selected`, KHÔNG phải `counts.total` (= orders.length).
 */
function summarizeTrackingOrders(orders) {
    const sent = orders.filter((o) => o.selected);
    const countVerify = (v) => sent.filter((o) => o.verify === v).length;
    return {
        total: orders.length,
        selected: sent.length,
        verified: countVerify("VERIFIED"),
        mismatch: sent.filter((o) => isVerifyFailure(o.verify)).length,
        not_found: countVerify("NOT_FOUND"),
        code_mismatch: countVerify("CODE_MISMATCH"),
        carrier_mismatch: countVerify("CARRIER_MISMATCH"),
        not_shipped: countVerify("NOT_SHIPPED"),
        failed: sent.filter((o) => o.add_status === "FAILED").length,
        // SKIPPED nhưng không phải do FAILED (đã tách failed ở trên) → "bỏ qua xác minh".
        skipped: sent.filter((o) => o.verify === "SKIPPED" && o.add_status !== "FAILED").length,
    };
}
/**
 * Tên bảng id CŨ (đã bỏ hẳn — id tự đoán, sai với Etsy: vd 6 tưởng Australia Post
 * nhưng Etsy hiểu là Canada Post; 5 bị Etsy nuốt mất tracking).
 * Chỉ để HIỂN THỊ đơn lịch sử đã lưu các id này = tên NGƯỜI DÙNG ĐÃ NHẬP lúc đó.
 */
const LEGACY_CARRIER_NAMES = {
    1: "USPS",
    2: "FedEx",
    3: "UPS",
    4: "DHL",
    5: "Canada Post",
    6: "Australia Post",
    7: "Royal Mail",
    8: "Deutsche Post",
    9: "La Poste",
    10: "Japan Post",
};
/** Tên carrier để hiển thị: -1 → other_carrier; id cũ trong lịch sử → tên đã nhập lúc đó. */
function carrierLabel(carrier, other_carrier) {
    if (carrier === -1)
        return other_carrier.trim();
    return LEGACY_CARRIER_NAMES[carrier] ?? other_carrier.trim();
}
/**
 * KHÔNG map tên → id nữa: Etsy nhận nguyên văn tên người dùng nhập qua
 * other_carrier (carrier = -1). Đảm bảo cái gì nhập vào là cái đó lên Etsy.
 */
function resolveCarrier(input) {
    return { carrier: -1, other_carrier: input.trim() };
}
