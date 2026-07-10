import { Show } from "solid-js";
import { css } from "styled-system/css";
import { Activity, Lock, TriangleAlert } from "lucide-solid";
import * as Card from "./ui/card.tsx";
import { Badge } from "./ui/badge.tsx";
import { StatusBadge } from "./StatusBadge.tsx";
import { PortionMenu } from "./PortionMenu.tsx";
import { UsageBar } from "./UsageBar.tsx";
import { gb, pct, staleness } from "./helpers.ts";
import {
  bodyStack,
  cardReset,
  headPad,
  headRight,
  headRow,
  metaItem,
  metaRow,
  staleNeutral,
  staleWarn,
  titleText,
  usageRow,
} from "./styles.ts";
import type { FriendRow } from "./types.ts";
import type { Pending } from "./action-dialog-shared.ts";

export function PortionCard(
  props: { friend: FriendRow; onAction: (p: Pending) => void },
) {
  const stale = () => staleness(props.friend.lastRequestAt);
  return (
    <Card.Root class={cardReset}>
      <Card.Header class={headPad}>
        <div class={headRow}>
          <Card.Title class={titleText}>{props.friend.name}</Card.Title>
          <div class={headRight}>
            <Badge variant="outline">{props.friend.isolationMode}</Badge>
            <StatusBadge status={props.friend.status} />
            <PortionMenu friend={props.friend} onAction={props.onAction} />
          </div>
        </div>
      </Card.Header>
      <Card.Body class={bodyStack}>
        <div class={usageRow}>
          <span>
            <strong>{gb(props.friend.usage.bytesUsed)}</strong>{" "}
            <span class={css({ color: "fg.muted" })}>
              / {gb(props.friend.usage.quotaBytes)}
            </span>
          </span>
          <span>{pct(props.friend.usage.fraction)}%</span>
        </div>
        <UsageBar fraction={props.friend.usage.fraction} />
        <div class={metaRow}>
          <span class={metaItem}>
            <Activity size={14} /> {props.friend.requests24h} / 24h
          </span>
          <span class={metaItem}>
            <Lock size={14} /> {props.friend.lockRetentionDays}d
          </span>
        </div>
        <span class={stale().warn ? staleWarn : staleNeutral}>
          <Show when={stale().warn}>
            <TriangleAlert size={14} />
          </Show>
          {stale().label}
        </span>
      </Card.Body>
    </Card.Root>
  );
}
