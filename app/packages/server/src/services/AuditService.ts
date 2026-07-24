import type { AuditAction, AuditEntryView } from "@p0rt1on/shared/domain";
import type { FriendQueries } from "../db/FriendQueries.ts";
import type { ProvisioningRepo } from "../provisioning/deps.ts";
import type { AuditService } from "./types.ts";

/** Read-side wrapper over FriendQueries plus the repo's audit writer. */
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
