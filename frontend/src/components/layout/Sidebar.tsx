"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Switch } from "@heroui/react";
import { useTheme } from "next-themes";
import { Users, Gamepad2, Trophy, Settings, PanelLeftClose, PanelLeftOpen, Sun, Moon, Database, BarChart3 } from "lucide-react";

interface SidebarProps {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
}

const navigation = [
  { name: "Players", href: "/dashboard", icon: Users },
  { name: "Teams", href: "/dashboard/teams", icon: Gamepad2 },
  { name: "Tournaments", href: "/dashboard/tournaments", icon: Trophy },
  { name: "Stats", href: "/dashboard/stats", icon: BarChart3 },
  { name: "WTT Database", href: "/dashboard/wtt", icon: Database },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function Sidebar({ isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "sticky top-16 h-[calc(100vh-4rem)] bg-content4 border-r border-content3 z-40 transition-all duration-300 shrink-0 flex flex-col",
          "max-lg:fixed max-lg:top-16 max-lg:left-0",
          isOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {/* Nav items */}
        <nav className={cn("flex-1 space-y-0.5", collapsed ? "p-2" : "p-2.5")}>
          {navigation.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                title={collapsed ? item.name : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center p-2.5" : "px-3 py-2",
                  isActive
                    ? "bg-content2 text-primary"
                    : "text-foreground/50 hover:bg-content2 hover:text-foreground"
                )}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle + collapse */}
        <div className={cn("border-t border-content3 flex flex-col gap-2", collapsed ? "items-center p-2" : "px-3 py-2")}>
          {/* Light/dark toggle */}
          <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
            {!collapsed && <span className="text-[10px] text-foreground/40">Theme</span>}
            {collapsed ? (
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="w-8 h-8 rounded-md flex items-center justify-center text-foreground/40 hover:text-foreground hover:bg-content2 transition-colors"
                title={theme === "dark" ? "Light mode" : "Dark mode"}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            ) : (
              <Switch
                size="sm"
                startContent={<Sun className="w-3 h-3" />}
                endContent={<Moon className="w-3 h-3" />}
                isSelected={theme === "dark"}
                onValueChange={(v) => setTheme(v ? "dark" : "light")}
              />
            )}
          </div>

          {/* Collapse toggle */}
          <div className={cn("flex", collapsed ? "justify-center" : "justify-end")}>
            <button
              onClick={onToggleCollapse}
              className="flex items-center justify-center w-8 h-8 rounded-md text-foreground/40 hover:text-foreground hover:bg-content2 transition-colors"
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
