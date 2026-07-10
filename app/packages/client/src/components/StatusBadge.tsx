import { Badge } from "./ui/badge.tsx";
import { badgeActive, badgeFailed, badgeNeutral } from "./styles.ts";

function statusBadgeClass(status: string) {
  if (status === "active") return badgeActive;
  if (status === "failed") return badgeFailed;
  return badgeNeutral;
}

export function StatusBadge(props: { status: string }) {
  return (
    <Badge variant="outline" class={statusBadgeClass(props.status)}>
      {props.status}
    </Badge>
  );
}
