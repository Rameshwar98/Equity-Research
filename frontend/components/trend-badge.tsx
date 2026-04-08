import { Badge } from "@/components/ui/badge";
import type { Signal } from "@/lib/types";

export function TrendBadge({ signal, className }: { signal: Signal; className?: string }) {
  if (signal === "BUY") return <Badge variant="buy" className={className}>BUY</Badge>;
  if (signal === "SELL") return <Badge variant="sell" className={className}>SELL</Badge>;
  if (signal === "HOLD") return <Badge variant="hold" className={className}>HOLD</Badge>;
  return <Badge variant="na" className={className}>N/A</Badge>;
}

