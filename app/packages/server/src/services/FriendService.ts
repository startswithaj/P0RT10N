import type { FriendDetail, FriendListItem } from "@p0rt1on/shared/domain";
import type { FriendDetailRow, FriendQueries } from "../db/FriendQueries.ts";
import type { McClientFactory } from "../minio/mc.ts";
import type { TailscaleApi } from "../tailscale/tailscale.ts";
import { serveEndpoint } from "../tailscale/serveEndpoint.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import { ConflictError, NotFoundError } from "../lib/ServiceError.ts";
import type { FriendService, Logger } from "./types.ts";

// Friend-lifecycle orchestrator: reads detail via FriendQueries, drives the
// external boundaries (mc, Tailscale), persists status/quota/audit via the repo.
// Owns side effects + compensation (unlike the thin query services).

export class FriendServiceImpl implements FriendService {
  constructor(
    private readonly queries: FriendQueries,
    private readonly friendRepo: ProvisioningRepo,
    private readonly mc: McClientFactory,
    private readonly tailscale: TailscaleApi,
    /** Endpoint scheme — must match how instances serve. */
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
    const ctx = await this.friendRepo.context(friendId);
    await this.mc.forInstance({ alias: ctx.alias, minioPort: ctx.minioPort })
      .setHardQuota(
        ctx.bucket,
        quotaBytes,
      );
    await this.friendRepo.setQuota(friendId, quotaBytes);
    await this.friendRepo.audit(friendId, "resize", `quotaBytes=${quotaBytes}`);
    log.info("quota resized");
    return this.get(friendId);
  }

  async suspend(friendId: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "suspend", friendId });
    log.info("suspending friend");
    await this.requireStatus(friendId, "active", "suspend");
    const ctx = await this.friendRepo.context(friendId);
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
      // Revoke failed: re-enable the S3 user and stay active so status matches real
      // access; surface the error. Retry re-runs both idempotent steps and converges.
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
    await this.friendRepo.setStatus(friendId, "suspended");
    await this.friendRepo.audit(friendId, "suspend");
    log.info("friend suspended");
    return this.get(friendId);
  }

  async resume(friendId: number): Promise<FriendDetail> {
    const log = this.logger.child({ op: "resume", friendId });
    log.info("resuming friend");
    await this.requireStatus(friendId, "suspended", "resume");
    const ctx = await this.friendRepo.context(friendId);
    // Re-enable the S3 user; the friend re-enrolls a node with a fresh key.
    // Status flips only after the enable succeeded (mirror of suspend).
    if (ctx.s3AccessKeyId) {
      await this.mc.forInstance({ alias: ctx.alias, minioPort: ctx.minioPort })
        .enableUser(
          ctx.s3AccessKeyId,
        );
    }
    await this.friendRepo.setStatus(friendId, "active");
    await this.friendRepo.audit(friendId, "resume");
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

  private async toDetail(
    row: FriendDetailRow,
    nodeOnline: boolean,
  ): Promise<FriendDetail> {
    const { tsHostname, ...rest } = row;
    return {
      ...rest,
      s3Endpoint: await serveEndpoint(
        this.tailscale,
        this.serveMode,
        tsHostname,
      ),
      nodeOnline,
    };
  }
}
