"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

// Posts is the social tab once switched on (SOCIAL=on, passed to the browser as NEXT_PUBLIC_SOCIAL).
const SOCIAL_ON = (process.env.NEXT_PUBLIC_SOCIAL ?? "").toLowerCase() === "on";

type Tab = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const TABS: Tab[] = [
  {
    href: "/",
    label: "Home",
    match: (p) => p === "/",
    icon: <path d="M3 5l4 4h10l4-4v11l-3.5 5h-13L3 16z M9.5 13.5v1 M14.5 13.5v1" {...stroke} />,
  },
  {
    href: "/pots/new",
    label: "Play",
    match: (p) => p.startsWith("/pots") || p.startsWith("/groups") || p.startsWith("/markets"),
    icon: (
      <>
        <circle cx="12" cy="12" r="9" {...stroke} />
        <path d="M12 8v8M8 12h8" {...stroke} />
      </>
    ),
  },
  {
    href: "/perps",
    label: "Perps",
    match: (p) => p.startsWith("/perps"),
    icon: <path d="M3 9c3 4 15 4 18 0 M5 5v10 M19 5v10 M3 19h18" {...stroke} />,
  },
  {
    href: SOCIAL_ON ? "/posts" : "/leaderboard",
    label: SOCIAL_ON ? "Social" : "Ranks",
    match: (p) => ["/posts", "/feed", "/leaderboard", "/honor"].some((x) => p === x || p.startsWith(`${x}/`)),
    icon: <path d="M4 5h16v11H9l-5 4z" {...stroke} />,
  },
  {
    href: "/account",
    label: "Me",
    match: (p) => p.startsWith("/account") || p.startsWith("/record"),
    icon: (
      <>
        <circle cx="12" cy="8" r="4" {...stroke} />
        <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...stroke} />
      </>
    ),
  },
];

/** The app's tab bar on phones and tablets (and in the installed app): the five places players go most. */
export function TabBar() {
  // The current page is only known at runtime: the tabs render plain first, then marked.
  return (
    <Suspense fallback={<Tabs path={null} />}>
      <TabsHere />
    </Suspense>
  );
}

function TabsHere() {
  return <Tabs path={usePathname() ?? "/"} />;
}

function Tabs({ path }: { path: string | null }) {
  return (
    <nav className="hc-tabbar" aria-label="Tabs">
      {TABS.map((t) => {
        const on = path !== null && t.match(path);
        return (
          <Link key={t.href} href={t.href} className="hc-tab" aria-current={on ? "page" : undefined}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              {t.icon}
            </svg>
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
