"use client";

/**
 * Bottom tab bar. Client component only because it needs the current path to
 * mark the active tab — the tabs themselves are plain links, so navigation
 * still works with JS disabled.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../ui";

const TABS = [
  { href: "/m/today", label: "Today", icon: "activity" },
  { href: "/m/clients", label: "Clients", icon: "list" },
];

export function TabBar() {
  const path = usePathname() ?? "";
  return (
    <nav className="m-tabs">
      {TABS.map((t) => {
        const on = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`m-tab${on ? " m-tab--on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            <Icon name={t.icon} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
