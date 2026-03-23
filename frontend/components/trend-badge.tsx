import { Badge } from "@/components/ui/badge";
import type { Signal } from "@/lib/types";

export function TrendBadge({ signal }: { signal: Signal }) {
  if (signal === "BUY") return <Badge variant="buy">BUY</Badge>;
  if (signal === "SELL") return <Badge variant="sell">SELL</Badge>;
  if (signal === "HOLD") return <Badge variant="hold">HOLD</Badge>;
  return <Badge variant="na">N/A</Badge>;
}

