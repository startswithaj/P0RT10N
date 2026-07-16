import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parseMinioEvent } from "./parseMinioEvent.ts";

describe("parseMinioEvent", () => {
  const now = () => "NOW";

  it("parses MinIO's nested {api:{…}} shape into a typed event", () => {
    const event = parseMinioEvent({
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
    const event = parseMinioEvent({
      api: { name: "GetObject", bucket: "bob" },
    }, now);
    expect(event?.time).toBe("NOW");
    expect(event?.accessKey).toBe("");
    expect(event?.statusCode).toBe(0);
    expect(event?.rx).toBe(0);
    expect(event?.tx).toBe(0);
  });

  it("returns null when bucket or op name is absent", () => {
    expect(parseMinioEvent({ api: { name: "PutObject" } }, now)).toBeNull();
    expect(parseMinioEvent({ api: { bucket: "bob" } }, now)).toBeNull();
  });

  it("returns null on unparseable input", () => {
    expect(parseMinioEvent({ nonsense: true }, now)).toBeNull();
    expect(parseMinioEvent("not-json", now)).toBeNull();
    expect(parseMinioEvent(null, now)).toBeNull();
  });
});
