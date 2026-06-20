import { SheetConfigManager } from "@/components/settings/SheetConfigManager";
import { OrderStatusManager } from "@/components/settings/OrderStatusManager";
import { MobileMenuButton } from "@/components/sidebar";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-1 flex items-center gap-2">
          <MobileMenuButton className="md:hidden" />
          <h1 className="text-2xl font-medium tracking-tight text-foreground">Cài đặt</h1>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">
          Kết nối Google Sheets để cập nhật trạng thái đơn ngay trên Meta.
        </p>
        <SheetConfigManager />
        <OrderStatusManager />
      </div>
    </div>
  );
}
