import type { HostnameWarning } from "@p0rt1on/shared/domain";
import type { ProvisioningRepo } from "./deps.ts";
import type { TailnetNode, TailscaleApi } from "../tailscale/tailscale.ts";

export interface HostnameTarget {
  friendId: number;
  tsHostname: string;
  serveNodeId: string | null;
}

function describeMismatch(tsHostname: string, actual: string | null): string {
  return `${tsHostname} is currently reachable at ${
    actual ?? "no serve node"
  }, not its pinned hostname`;
}

/**
 * Holds no state: the audit trail is the record of what was already announced,
 * so a restart never re-announces a known mismatch, and the check is served off
 * its own endpoint rather than the dashboard's hot path.
 */
export class HostnameHealthChecker {
  constructor(
    private readonly repo: Pick<
      ProvisioningRepo,
      "audit" | "lastHostnameEvent"
    >,
    private readonly tailscale: Pick<TailscaleApi, "nodesByTag">,
    private readonly serveNodeTag: string,
  ) {}

  /** One Tailscale fetch covers every target. */
  async check(targets: HostnameTarget[]): Promise<HostnameWarning[]> {
    if (targets.length === 0) return [];
    const nodes = await this.tailscale.nodesByTag(this.serveNodeTag)
      .catch(() => null);
    const checked = await Promise.all(
      targets.map((t) => this.checkOne(t, nodes)),
    );
    return checked.filter((c): c is HostnameWarning => c !== null);
  }

  private async checkOne(
    target: HostnameTarget,
    nodes: TailnetNode[] | null,
  ): Promise<HostnameWarning | null> {
    const last = await this.repo.lastHostnameEvent(target.friendId);
    // Only an unclaimed row means a warning is still outstanding; accepted and
    // recovered both close one out.
    const previous = last?.action === "instance_hostname_unclaimed"
      ? last.detail
      : null;

    // Tailscale unreachable: keep reporting the last known mismatch rather than
    // reporting healthy, which would hide a real one behind an outage.
    if (nodes === null) {
      return previous ? { friendId: target.friendId, warning: previous } : null;
    }

    const actual = nodes.find((n) => n.nodeId === target.serveNodeId)
      ?.hostname ?? null;
    const warning = actual === target.tsHostname
      ? null
      : describeMismatch(target.tsHostname, actual);

    if (warning && previous !== warning) {
      await this.repo.audit(
        target.friendId,
        "instance_hostname_unclaimed",
        warning,
      );
    } else if (!warning && previous) {
      await this.repo.audit(
        target.friendId,
        "instance_recovered",
        `${target.tsHostname} reclaimed its pinned hostname`,
      );
    }

    return warning ? { friendId: target.friendId, warning } : null;
  }
}
