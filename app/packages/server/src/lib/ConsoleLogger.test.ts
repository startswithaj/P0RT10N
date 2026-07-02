import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { ConsoleLogger, type LogSink } from "./ConsoleLogger.ts";
import type { LogLevel } from "../services/types.ts";

describe("ConsoleLogger", () => {
  const capturing = (level?: LogLevel) => {
    const lines: { level: string; line: string }[] = [];
    const sink: LogSink = (l, line) => lines.push({ level: l, line });
    const log = new ConsoleLogger({ level, sink, now: () => "T" });
    return { log, lines };
  };

  it("formats as `<time> <LEVEL> <message> <json-meta>`", () => {
    const { log, lines } = capturing("debug");
    log.info("hello", { a: 1 });
    expect(lines[0]).toEqual({ level: "info", line: `T INFO  hello {"a":1}` });
  });

  it("omits the meta segment when there is none", () => {
    const { log, lines } = capturing("debug");
    log.warn("careful");
    expect(lines[0].line).toBe("T WARN  careful");
  });

  it("drops records below the configured level", () => {
    const { log, lines } = capturing("warn");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => l.level)).toEqual(["warn", "error"]);
  });

  it("defaults to the info threshold", () => {
    const { log, lines } = capturing();
    log.debug("nope");
    log.info("yes");
    expect(lines.map((l) => l.level)).toEqual(["info"]);
  });

  it("child merges bindings into every record and inherits level + sink", () => {
    const { log, lines } = capturing("debug");
    const child = log.child({ friendId: 7, op: "add" });
    child.info("step", { step: 1 });
    expect(lines[0].line).toBe(
      `T INFO  step {"friendId":7,"op":"add","step":1}`,
    );
  });

  it("nested children accumulate bindings; call meta overrides them", () => {
    const { log, lines } = capturing("debug");
    log.child({ a: 1 }).child({ b: 2 }).error("boom", { a: 9 });
    expect(lines[0].line).toBe(`T ERROR boom {"a":9,"b":2}`);
  });

  it("routes levels to the matching console method by default", () => {
    const log = new ConsoleLogger({ level: "debug" });
    expect(() => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    }).not.toThrow();
  });
});
