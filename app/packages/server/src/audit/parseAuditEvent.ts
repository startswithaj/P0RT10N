import { z } from "zod";

// ============================================================================
// Parse+validate a raw MinIO audit-webhook payload into the typed view OUR OWN
// consumers use (the aggregator's counting, the live stream's per-friend
// filter). The forwarder never calls this — it ships the raw payload untouched.
// ============================================================================

/** The fields we fold from a MinIO audit entry. */
export interface AuditEvent {
  bucket: string;
  op: string;
  statusCode: number;
  rx: number;
  tx: number;
  time: string;
  // Top-level access key of the caller; distinguishes friend traffic from the
  // manager's own root-key polling (mc du/admin).
  accessKey: string;
}

// MinIO audit entries nest the useful bits under `api`; parse defensively.
const auditSchema = z.object({
  time: z.string().optional(),
  accessKey: z.string().optional(),
  api: z.object({
    name: z.string().optional(),
    bucket: z.string().optional(),
    statusCode: z.number().optional(),
    rx: z.number().optional(),
    tx: z.number().optional(),
  }).optional(),
});

/** Parse+validate a raw MinIO audit payload once; null if not a usable event. */
export function parseAuditEvent(
  raw: unknown,
  now: () => string,
): AuditEvent | null {
  const parsed = auditSchema.safeParse(raw);
  if (!parsed.success) return null;
  const api = parsed.data.api;
  if (!api?.bucket || !api.name) return null;
  return {
    bucket: api.bucket,
    op: api.name,
    statusCode: api.statusCode ?? 0,
    rx: api.rx ?? 0,
    tx: api.tx ?? 0,
    time: parsed.data.time ?? now(),
    accessKey: parsed.data.accessKey ?? "",
  };
}
