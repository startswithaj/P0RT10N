import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parseAuditEvent } from "./parseAuditEvent.ts";

describe("parseAuditEvent", () => {
  const now = () => "NOW";

  it("parses MinIO's nested {api:{…}} shape into a typed event", () => {
    const event = parseAuditEvent({
      time: "2026-06-30T10:00:00Z",
      accessKey: "FRIENDKEY",
      api: { name: "PutObject", bucket: "bob", statusCode: 200, rx: 10, tx: 2 },
    }, now);
    expect(event).toEqual({
      bucket: "bob",
      op: "PutObject",
      statusCode: 200,
      rx: 10,
      tx: 2,
      time: "2026-06-30T10:00:00Z",
      accessKey: "FRIENDKEY",
    });
  });

  it("defaults missing time/accessKey/counters", () => {
    const event = parseAuditEvent({
      api: { name: "GetObject", bucket: "bob" },
    }, now);
    expect(event?.time).toBe("NOW");
    expect(event?.accessKey).toBe("");
    expect(event?.statusCode).toBe(0);
    expect(event?.rx).toBe(0);
    expect(event?.tx).toBe(0);
  });

  it("returns null when bucket or op name is absent", () => {
    expect(parseAuditEvent({ api: { name: "PutObject" } }, now)).toBeNull();
    expect(parseAuditEvent({ api: { bucket: "bob" } }, now)).toBeNull();
  });

  it("returns null on unparseable input", () => {
    expect(parseAuditEvent({ nonsense: true }, now)).toBeNull();
    expect(parseAuditEvent("not-json", now)).toBeNull();
    expect(parseAuditEvent(null, now)).toBeNull();
  });
});
