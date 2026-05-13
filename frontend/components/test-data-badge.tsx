import { cn } from "@/lib/utils";

export function TestDataBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-yellow-600/70 bg-yellow-400/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-yellow-950 shadow-sm dark:border-yellow-500/80 dark:bg-yellow-500/85 dark:text-yellow-950",
        className
      )}
      title="This portfolio was filled with simulated test history for UI preview only."
    >
      TEST DATA
    </span>
  );
}
