import plugin from "./one-service-per-file.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("passes with a single service class", () => {
  const src = `export class FriendServiceImpl {}\n`;
  const d = Deno.lint.runPlugin(plugin, "FriendService.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("flags a second service in the file", () => {
  const src =
    `export class FriendServiceImpl {}\nexport class AuditServiceImpl {}\n`;
  const d = Deno.lint.runPlugin(plugin, "FriendService.ts", src);
  assertEquals(d.length, 1);
});

Deno.test("flags every service beyond one, even thin wrappers", () => {
  const src =
    `export class UsageServiceImpl {}\nexport class AuditServiceImpl {}\nexport class ActivityServiceImpl {}\n`;
  const d = Deno.lint.runPlugin(plugin, "queryServices.ts", src);
  assertEquals(d.length, 2);
});

Deno.test("keeps the service named after the file, flags the other", () => {
  const src =
    `export class UsageServiceImpl {}\nexport class AuditServiceImpl {}\n`;
  const d = Deno.lint.runPlugin(plugin, "AuditService.ts", src);
  // AuditServiceImpl matches the file → kept; UsageServiceImpl is flagged.
  assertEquals(d.length, 1);
  assertEquals(d[0].message.includes("UsageServiceImpl"), true);
});

Deno.test("ignores a non-service helper class beside a service", () => {
  const src = `export class FriendServiceImpl {}\nclass Naming {}\n`;
  const d = Deno.lint.runPlugin(plugin, "FriendService.ts", src);
  assertEquals(d.length, 0);
});

Deno.test("exempts test files", () => {
  const src = `export class FooService {}\nexport class BarService {}\n`;
  const d = Deno.lint.runPlugin(plugin, "Foo.test.ts", src);
  assertEquals(d.length, 0);
});
