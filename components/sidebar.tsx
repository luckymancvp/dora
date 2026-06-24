"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import {
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Settings,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ShoppingBag,
  Truck,
} from "lucide-react"
import { signOut, useSession } from "next-auth/react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ThemeToggle } from "@/components/theme-toggle"
import { useMobileNav } from "@/lib/store/mobile-nav"

/** Nút hamburger mở drawer sidebar — chỉ hiện trên mobile. Nhúng vào header các trang. */
export function MobileMenuButton({ className }: { className?: string }) {
  const { toggle } = useMobileNav()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Mở menu"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <Menu className="h-5 w-5" />
    </button>
  )
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/messages", label: "Messenger", icon: MessageCircle },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/tracking", label: "Tracking", icon: Truck },
]

const COLLAPSE_KEY = "sidebar.collapsed.v1"

export function Sidebar() {
  const pathname = usePathname()
  const { data: session, status } = useSession()
  const { open, close } = useMobileNav()
  const [collapsed, setCollapsed] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Phát hiện mobile để: trên drawer luôn hiển thị dạng mở rộng (bỏ qua trạng thái thu gọn của desktop).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  // Khôi phục trạng thái thu gọn từ localStorage.
  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSE_KEY)
    if (saved !== null) setCollapsed(saved === "1")
    setHydrated(true)
  }, [])

  // Lưu lại mỗi khi đổi (sau hydrate).
  useEffect(() => {
    if (hydrated) localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0")
  }, [collapsed, hydrated])

  useEffect(() => {
    if (status === "unauthenticated" && pathname !== "/login") {
      signOut({ redirectTo: "/login" })
    }
  }, [status, pathname])

  if (pathname === "/login") return null

  const user = session?.user
  const displayName = user?.name ?? "Khách"
  const initials = (user?.name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .slice(-2)
    .join("")
    .toUpperCase()

  // Trên mobile (drawer) luôn hiển thị dạng mở rộng, không áp dụng thu gọn của desktop.
  const effectiveCollapsed = collapsed && !isMobile

  // Class chung cho 1 dòng (nav/footer): nút vuông bo góc khi thu gọn, pill đầy đủ khi mở.
  const rowClass = cn(
    "flex items-center text-sm font-bold transition-colors",
    effectiveCollapsed
      ? "mx-auto h-11 w-11 justify-center rounded-2xl"
      : "w-full justify-start gap-3 rounded-full px-4 py-3",
  )

  return (
    <>
      {/* Backdrop drawer mobile */}
      {open && (
        <div
          onClick={close}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      )}
      <aside
        className={cn(
          "flex h-full flex-col border-r border-sidebar-border bg-sidebar py-5 transition-[width,transform] duration-200",
          "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          effectiveCollapsed ? "w-20 items-center px-3" : "w-64 items-stretch px-4",
        )}
      >
      {/* Logo + nút thu gọn */}
      <div
        className={cn(
          "pb-8",
          effectiveCollapsed ? "flex flex-col items-center gap-3" : "flex items-center gap-2 px-2",
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <MessagesSquare className="h-5 w-5" />
        </div>
        {!effectiveCollapsed && (
          <span className="text-lg font-bold tracking-tight">EtsyChat</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          title={collapsed ? "Mở rộng menu" : "Thu gọn menu"}
          className={cn(
            "hidden h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:flex",
            !collapsed && "ml-auto",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <PanelLeftClose className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              title={effectiveCollapsed ? item.label : undefined}
              className={cn(
                rowClass,
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!effectiveCollapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto flex flex-col gap-1 pt-4">
        <Link
          href="/settings"
          onClick={close}
          title={effectiveCollapsed ? "Cài đặt" : undefined}
          className={cn(
            rowClass,
            pathname.startsWith("/settings")
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <Settings className="h-5 w-5 shrink-0" />
          {!effectiveCollapsed && <span>Cài đặt</span>}
        </Link>
        <ThemeToggle collapsed={effectiveCollapsed} />
        <div
          className={cn(
            "flex items-center gap-3 rounded-full py-2",
            effectiveCollapsed ? "mx-auto h-11 w-11 justify-center px-0" : "justify-start px-2",
          )}
        >
          <Avatar className="h-9 w-9">
            {user?.image ? (
              <AvatarImage src={user.image} alt={displayName} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-bold">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          {!effectiveCollapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold leading-tight">{displayName}</span>
              <span className="text-xs text-muted-foreground leading-tight">
                {user ? "Đang hoạt động" : "Chưa đăng nhập"}
              </span>
            </div>
          )}
        </div>
        {user ? (
          <button
            type="button"
            onClick={() => signOut({ redirectTo: "/login" })}
            title={effectiveCollapsed ? "Đăng xuất" : undefined}
            className={cn(
              rowClass,
              "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <LogOut className="h-5 w-5 shrink-0" />
            {!effectiveCollapsed && <span>Đăng xuất</span>}
          </button>
        ) : null}
      </div>
      </aside>
    </>
  )
}
