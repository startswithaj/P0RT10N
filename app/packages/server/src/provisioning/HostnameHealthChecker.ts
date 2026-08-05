import type { ProvisioningRepo } from "./deps.ts";
import type { TailnetNode, TailscaleApi } from "../tailscale/tailscale.ts";

const DEFAULT_WARNING_TTL_MS = 5 * 60_000;
const DEFAULT_NODES_TTL_MS = 60_000;

function describeMismatch(tsHostname: string, actual: string | null): string {
  return `${tsHostname} is currently reachable at ${
    actual ?? "no serve node"
  }, not its pinned hostname`;
}

export class HostnameHealthChecker {
  private readonly cache = new Map<
    number,
    { warning: string | null; checkedAt: number }
  >();
  private nodesCache: { nodes: TailnetNode[]; fetchedAt: number } | null = null;
  private nodesPromise: Promise<TailnetNode[]> | null = null;

  constructor(
    private readonly repo: Pick<ProvisioningRepo, "audit">,
    private readonly tailscale: Pick<TailscaleApi, "nodesByTag">,
    private readonly serveNodeTag: string,
    private readonly warningTtlMs: number = DEFAULT_WARNING_TTL_MS,
    private readonly nodesTtlMs: number = DEFAULT_NODES_TTL_MS,
  ) {}

  // Never throws on a Tailscale failure — falls back to the last known
  // warning (or null) instead, so a dashboard row can't break from this.
  async checkHostname(
    instanceId: number,
    tsHostname: string,
    serveNodeId: string | null,
  ): Promise<string | null> {
    const cached = this.cache.get(instanceId);
    if (cached && Date.now() - cached.checkedAt < this.warningTtlMs) {
      return cached.warning;
    }

    const nodes = await this.nodes().catch(() => null);
    if (nodes === null) return cached?.warning ?? null;

    const actual = nodes.find((n) => n.nodeId === serveNodeId)?.hostname ??
      null;
    const warning = actual === tsHostname
      ? null
      : describeMismatch(tsHostname, actual);

    if (warning && cached?.warning !== warning) {
      await this.repo.audit(null, "instance_hostname_unclaimed", warning);
    } else if (!warning && cached?.warning) {
      await this.repo.audit(
        null,
        "instance_recovered",
        `${tsHostname} reclaimed its pinned hostname`,
      );
    }

    this.cache.set(instanceId, { warning, checkedAt: Date.now() });
    return warning;
  }

  // Shared/deduped across calls; TTL shorter than warningTtlMs on purpose.
  private async nodes(): Promise<TailnetNode[]> {
    if (
      this.nodesCache &&
      Date.now() - this.nodesCache.fetchedAt < this.nodesTtlMs
    ) {
      return this.nodesCache.nodes;
    }
    if (!this.nodesPromise) {
      this.nodesPromise = this.tailscale.nodesByTag(this.serveNodeTag)
        .finally(() => {
          this.nodesPromise = null;
        });
    }
    const nodes = await this.nodesPromise;
    this.nodesCache = { nodes, fetchedAt: Date.now() };
    return nodes;
  }
}
