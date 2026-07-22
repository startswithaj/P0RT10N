import type {
  ActivityView,
  AuditAction,
  AuditEntryView,
  FriendDetail,
  FriendListItem,
  UsageView,
} from "@p0rt1on/shared/domain";
import type { FriendDetailRow, FriendQueries } from "../db/FriendQueries.ts";
import type { McClientFactory } from "../minio/mc.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import {
  ConflictError,
  NotFoundError,
  NotImplementedError,
} from "../lib/ServiceError.ts";
import type {
  ActivityService,
  AuditService,
  FriendService,
  Logger,
  UsageService,
} from "./types.ts";

// ============================================================================
// Service impls backed by FriendQueries (read-side) + the external boundaries
// (`mc`, Tailscale) for the lightweight mutations. ActivityService.stream is
// still NOT_IMPLEMENTED until the audit-event bus lands (#9).
// ============================================================================

export class FriendServiceImpl implements FriendService {
  constructor(
    private readonly queries: FriendQueries,
    private readonly repo: ProvisioningRepo,
    private readonly mc: McClientFactory,
    private readonly tailscale: TailscaleApi,
    private readonly tailnetDomain: string,
    /** Endpoint scheme — must match how instances serve (see ProvisioningConfig). */
    private readonly serveMode: "https" | "http",
    private readonly logger: Logger,
  ) {}

  list(): Promise<FriendListItem[]> {
    return this.queries.list();
  }

  async get(friendId: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "get", friendId });
    log.debug("loading friend detail");
    const row = await this.queries.detail(friendId);
    if (!row) throw new NotFoundError(`friend ${friendId} not found`);
    const nodeOnline = await this.tailscale.isNodeOnline(row.tsNodeTag);
    return this.toDetail(row, nodeOnline);
  }

  async resize(friendId: number, quotaBytes: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "resize", friendId });
    log.info("resizing quota", { quotaBytes });
    const ctx = await this.repo.context(friendId);
    await this.mc.forInstance({ alias: ctx.alias, minioPort: ctx.minioPort })
      .setHardQuota(
        ctx.bucket,
        quotaBytes,
      );
    await this.repo.setQuota(friendId, quotaBytes);
    await this.repo.audit(friendId, "resize", `quotaBytes=${quotaBytes}`);
    log.info("quota resized");
    return this.get(friendId);
  }

  async suspend(friendId: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "suspend", friendId });
    log.info("suspending friend");
    await this.requireStatus(friendId, "active", "suspend");
    const ctx = await this.repo.context(friendId);
    // Disable the S3 user (reversible) + revoke the friend's tailnet nodes.
    if (ctx.s3AccessKeyId) {
      await this.mc.forInstance({ alias: ctx.alias, minioPort: ctx.minioPort })
        .disableUser(
          ctx.s3AccessKeyId,
        );
    }
    try {
      await this.revokeNodes(ctx.nodeTag, log);
    } catch (err) {
      // The displayed status must match actual access: the revoke failed, so
      // compensate by re-enabling the S3 user and stay `active`, surfacing
      // the error. A retry re-runs both steps (each idempotent) and converges.
      log.error("node revoke failed; re-enabling S3 user to stay consistent", {
        error: String(err),
      });
      if (ctx.s3AccessKeyId) {
        await this.mc.forInstance({
          alias: ctx.alias,
          minioPort: ctx.minioPort,
        })
          .enableUser(ctx.s3AccessKeyId)
          .catch((e) =>
            // Access is now half-revoked while status says active — loud;
            // retrying suspend still converges.
            log.error("compensating enableUser failed too", {
              error: String(e),
            })
          );
      }
      throw err;
    }
    await this.repo.setStatus(friendId, "suspended");
    await this.repo.audit(friendId, "suspend");
    log.info("friend suspended");
    return this.get(friendId);
  }

  async resume(friendId: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "resume", friendId });
    log.info("resuming friend");
    await this.requireStatus(friendId, "suspended", "resume");
    const ctx = await this.repo.context(friendId);
    // Re-enable the S3 user; the friend re-enrolls a node with a fresh key.
    // Status flips only after the enable succeeded (mirror of suspend).
    if (ctx.s3AccessKeyId) {
      await this.mc.forInstance({ alias: ctx.alias, minioPort: ctx.minioPort })
        .enableUser(
          ctx.s3AccessKeyId,
        );
    }
    await this.repo.setStatus(friendId, "active");
    await this.repo.audit(friendId, "resume");
    log.info("friend resumed");
    return this.get(friendId);
  }

  /** State guard: the operation only makes sense from one source status. */
  private async requireStatus(
    friendId: number,
    required: FriendDetail["status"],
    op: string,
  ): Promise<void> {
    const row = await this.queries.detail(friendId);
    if (!row) throw new NotFoundError(`friend ${friendId} not found`);
    if (row.status !== required) {
      throw new ConflictError(
        `cannot ${op} a ${row.status} friend — only ${required} friends can be ${op}d`,
      );
    }
  }

  private async revokeNodes(tag: string, log: Logger): Promise<void> {
    const nodes = await this.tailscale.nodesByTag(tag);
    log.debug("revoking friend nodes", { tag, count: nodes.length });
    await Promise.all(
      nodes.map((node) => this.tailscale.deleteNode(node.nodeId)),
    );
  }

  private toDetail(row: FriendDetailRow, nodeOnline: boolean): FriendDetail {
    const { tsHostname, ...rest } = row;
    return {
      ...rest,
      s3Endpoint: `${this.serveMode}://${tsHostname}.${this.tailnetDomain}`,
      nodeOnline,
    };
  }
}

export class UsageServiceImpl implements UsageService {
  constructor(private readonly queries: FriendQueries) {}

  history(friendId: number, limit: number): Promise<UsageView[]> {
    return this.queries.usageHistory(friendId, limit);
  }
}

export class AuditServiceImpl implements AuditService {
  constructor(
    private readonly queries: FriendQueries,
    // The write side lives on the repo; only `audit` is needed here.
    private readonly writer: Pick<ProvisioningRepo, "audit">,
  ) {}

  list(limit: number, before?: number): Promise<AuditEntryView[]> {
    return this.queries.recentAuditEntries(limit, before);
  }

  record(action: AuditAction, detail?: string): Promise<void> {
    return this.writer.audit(null, action, detail);
  }
}

export class ActivityServiceImpl implements ActivityService {
  constructor(private readonly queries: FriendQueries) {}

  current(friendId: number): Promise<ActivityView> {
    return this.queries.activityFor(friendId);
  }

  // The live stream needs the audit-event bus — pending the aggregator impl.
  // Returns an iterable that throws on iteration (so the subscription errors).
  stream(_friendId: number, _signal: AbortSignal): AsyncIterable<ActivityView> {
    return {
      [Symbol.asyncIterator]() {
        throw new NotImplementedError(
          "ActivityService.stream not implemented",
        );
      },
    };
  }
}
