import { z } from "zod";

// The only place raw MinIO audit-webhook payloads get parsed; the forwarder
// ships the raw payload untouched.

export interface MinioEvent {
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
const minioEventSchema = z.object({
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

export function parseMinioEvent(
  raw: unknown,
  now: () => string = () => new Date().toISOString(),
): MinioEvent | null {
  const parsed = minioEventSchema.safeParse(raw);
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

export async function* parseMinioEvents(
  src: AsyncIterable<unknown>,
): AsyncIterable<MinioEvent> {
  // deno-lint-ignore custom-no-imperative-loops/no-imperative-loops
  for await (const raw of src) {
    const event = parseMinioEvent(raw);
    if (event) yield event;
  }
}
