"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";

function NavLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const pathname = usePathname();
  const active =
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Button asChild variant={active ? "default" : "outline"} className="h-8 px-3 text-xs">
      <Link href={href}>{label}</Link>
    </Button>
  );
}

export function AppHeader() {
  return (
    <div className="border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto max-w-[1480px] px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="mr-1 text-sm font-semibold tracking-tight text-foreground">
              Equity Analysis Dashboard
            </div>
            <div className="flex items-center gap-2">
              <NavLink href="/" label="Screener" />
              <NavLink href="/portfolios" label="Portfolios" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}

