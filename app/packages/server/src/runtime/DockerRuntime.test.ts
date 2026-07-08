import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { DockerInstanceRuntime, DockerRuntime } from "./DockerRuntime.ts";
import type { ContainerHandle, ContainerRuntime } from "./runtime.ts";
import {
  cmdOk as ok,
  fakeRunner,
  INSTANCE_SPEC as INSTANCE,
  type RecordedCommand,
  respondAbsentInspect as absentInspect,
} from "../test-helpers/mocks.ts";

describe("DockerRuntime.ensureInstance", () => {
  it("runs the combined container: network, both volumes, env, no host port", async () => {
    const cmds: RecordedCommand[] = [];
    const handle = await new DockerRuntime(fakeRunner(cmds, absentInspect))
      .ensureInstance(INSTANCE);

    expect(handle).toEqual({
      name: "p0rt1on-instance-alice",
      id: "newid",
      state: "running",
    });
    const run = cmds.find((c) => c.args[0] === "run");
    expect(run?.args).toEqual([
      "run",
      "-d",
      "--name",
      "p0rt1on-instance-alice",
      "--label",
      "p0rt1on=1",
      "--network",
      "p0rt1on-net",
      "--restart",
      "unless-stopped",
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      "127.0.0.1:9100:9100",
      "-v",
      "p0rt1on-data-alice:/data",
      "-v",
      "p0rt1on-tsstate-alice:/var/lib/tailscale",
      "--env-file",
      "/run/secrets/minio-alice.env",
      "-e",
      "TAILSCALE_HOSTNAME=alice",
      "-e",
      "TAILSCALE_TAG=tag:p0rt1on-serve",
      "-e",
      "MINIO_PORT=9100",
      "p0rt1on-instance:x",
    ]);
    // MinIO is published to host loopback so the manager reaches it for admin.
    expect(run?.args).toContain("127.0.0.1:9100:9100");
  });

  it("never puts the auth key on the docker argv, and a failed run can't leak it", async () => {
    const cmds: RecordedCommand[] = [];
    await new DockerRuntime(fakeRunner(cmds, absentInspect))
      .ensureInstance(INSTANCE);
    // The key travels only in the env-file named by rootCredSecretRef.
    const run = cmds.find((c) => c.args[0] === "run");
    expect(run?.args.some((a) => a.includes("AUTHKEY"))).toBe(false);

    const failing = (args: string[]) =>
      args[0] === "inspect"
        ? { code: 1, stdout: "", stderr: "no such object" }
        : { code: 125, stdout: "", stderr: "docker: cannot start" };
    const err = await new DockerRuntime(fakeRunner([], failing))
      .ensureInstance(INSTANCE)
      .then(() => null, (e: Error) => e.message);
    expect(err).toContain("docker run");
    expect(err).not.toContain("tskey");
  });

  it("adopts a running container without starting a second", async () => {
    const cmds: RecordedCommand[] = [];
    const handle = await new DockerRuntime(
      fakeRunner(cmds, () => ok("abc running")),
    )
      .ensureInstance(INSTANCE);
    expect(handle.id).toBe("abc");
    expect(cmds.some((c) => c.args[0] === "run")).toBe(false);
    // Adopted containers may predate the restart policy — it's applied in place.
    expect(
      cmds.some((c) =>
        c.args.join(" ") === "update --restart unless-stopped " + INSTANCE.name
      ),
    ).toBe(true);
  });

  it("starts a stopped container (after retrofitting the restart policy)", async () => {
    const cmds: RecordedCommand[] = [];
    const respond = (args: string[]) =>
      args[0] === "inspect" ? ok("abc exited") : ok();
    await new DockerRuntime(fakeRunner(cmds, respond)).ensureInstance(INSTANCE);
    const verbs = cmds.map((c) => c.args[0]);
    expect(verbs.indexOf("update")).toBeLessThan(verbs.indexOf("start"));
  });
});

describe("DockerRuntime.ensureStarted", () => {
  it("already running: no start, but the restart policy still converges", async () => {
    const cmds: RecordedCommand[] = [];
    await new DockerRuntime(fakeRunner(cmds, () => ok("abc running")))
      .ensureStarted("x");
    expect(cmds.some((c) => c.args[0] === "start")).toBe(false);
    expect(cmds.some((c) => c.args[0] === "update")).toBe(true);
  });

  it("starts a stopped container", async () => {
    const cmds: RecordedCommand[] = [];
    const respond = (args: string[]) =>
      args[0] === "inspect" ? ok("abc exited") : ok();
    await new DockerRuntime(fakeRunner(cmds, respond)).ensureStarted("x");
    expect(cmds.some((c) => c.args[0] === "start")).toBe(true);
  });

  it("throws for an absent container instead of inventing one", async () => {
    const rt = new DockerRuntime(
      fakeRunner([], () => ({ code: 1, stdout: "", stderr: "no such" })),
    );
    await expect(rt.ensureStarted("x")).rejects.toThrow("cannot adopt");
  });
});

describe("DockerRuntime.health", () => {
  it("maps the container's HEALTHCHECK status", async () => {
    const healthy = new DockerRuntime(fakeRunner([], () => ok("healthy\n")));
    expect(await healthy.health("x")).toBe("healthy");

    const starting = new DockerRuntime(fakeRunner([], () => ok("starting")));
    expect(await starting.health("x")).toBe("starting");

    const none = new DockerRuntime(fakeRunner([], () => ok(""))); // no healthcheck
    expect(await none.health("x")).toBe("unknown");

    const missing = new DockerRuntime(
      fakeRunner([], () => ({ code: 1, stdout: "", stderr: "" })),
    );
    expect(await missing.health("x")).toBe("unknown");
  });
});

describe("DockerRuntime.diagnose", () => {
  it("assembles state + health reason + exit + logs", async () => {
    const state = JSON.stringify({
      Status: "exited",
      ExitCode: 1,
      Error: "boom",
      Health: { Status: "unhealthy", Log: [{ Output: "minio not live\n" }] },
    });
    const respond = (args: string[]) =>
      args[0] === "inspect" ? ok(state) : ok("line1\nline2\n");
    const d = await new DockerRuntime(fakeRunner([], respond)).diagnose("x");

    expect(d.state).toBe("stopped");
    expect(d.health).toBe("unhealthy");
    expect(d.healthReason).toBe("minio not live");
    expect(d.exitCode).toBe(1);
    expect(d.exitError).toBe("boom");
    expect(d.recentLogs).toBe("line1\nline2");
  });

  it("reports absent (no logs) when the container is not found", async () => {
    const d = await new DockerRuntime(
      fakeRunner([], () => ({ code: 1, stdout: "", stderr: "" })),
    ).diagnose("x");
    expect(d.state).toBe("absent");
    expect(d.recentLogs).toBe("");
  });
});

describe("DockerRuntime lifecycle", () => {
  it("status maps running / absent", async () => {
    const running = new DockerRuntime(fakeRunner([], () => ok("id running")));
    expect(await running.status("x")).toBe("running");
    const absent = new DockerRuntime(
      fakeRunner([], () => ({ code: 1, stdout: "", stderr: "" })),
    );
    expect(await absent.status("x")).toBe("absent");
  });

  it("stop is a no-op when not running", async () => {
    const cmds: RecordedCommand[] = [];
    await new DockerRuntime(fakeRunner(cmds, () => ok("id exited"))).stop("x");
    expect(cmds.some((c) => c.args[0] === "stop")).toBe(false);
  });

  it("remove passes -v only when removeVolume", async () => {
    const cmds: RecordedCommand[] = [];
    const rt = new DockerRuntime(fakeRunner(cmds, () => ok()));
    await rt.remove("x", { removeVolume: true });
    await rt.remove("y", { removeVolume: false });
    expect(cmds[0].args).toEqual(["rm", "-f", "-v", "x"]);
    expect(cmds[1].args).toEqual(["rm", "-f", "y"]);
  });

  it("removeVolumes runs `docker volume rm` for named volumes", async () => {
    const cmds: RecordedCommand[] = [];
    await new DockerRuntime(fakeRunner(cmds, () => ok())).removeVolumes([
      "v1",
      "v2",
    ]);
    expect(cmds[0].args).toEqual(["volume", "rm", "-f", "v1", "v2"]);
  });

  it("removeVolumes is a no-op for an empty list", async () => {
    const cmds: RecordedCommand[] = [];
    await new DockerRuntime(fakeRunner(cmds, () => ok())).removeVolumes([]);
    expect(cmds.length).toBe(0);
  });

  it("list parses labelled containers", async () => {
    const respond = () =>
      ok("p0rt1on-instance-a|1|running\np0rt1on-instance-b|2|exited\n");
    const list = await new DockerRuntime(fakeRunner([], respond)).list();
    expect(list).toEqual([
      { name: "p0rt1on-instance-a", id: "1", state: "running" },
      { name: "p0rt1on-instance-b", id: "2", state: "stopped" },
    ]);
  });

  it("throws with stderr on a failed command", async () => {
    const respond = () => ({ code: 1, stdout: "", stderr: "boom" });
    await expect(
      new DockerRuntime(fakeRunner([], respond)).remove("x", {
        removeVolume: false,
      }),
    ).rejects.toThrow("boom");
  });
});

describe("DockerInstanceRuntime", () => {
  function recordingRuntime(calls: string[]): ContainerRuntime {
    const handle = (name: string): ContainerHandle => ({
      name,
      id: "id",
      state: "running",
    });
    return {
      ensureInstance: (s) => {
        calls.push(`ensureInstance:${s.name}`);
        return Promise.resolve(handle(s.name));
      },
      ensureStarted: (n) => {
        calls.push(`ensureStarted:${n}`);
        return Promise.resolve();
      },
      status: () => Promise.resolve("running"),
      health: () => Promise.resolve("healthy"),
      diagnose: (n) =>
        Promise.resolve({
          name: n,
          state: "running",
          health: "healthy",
          healthReason: null,
          exitCode: null,
          exitError: null,
          recentLogs: "",
        }),
      stop: (n) => {
        calls.push(`stop:${n}`);
        return Promise.resolve();
      },
      remove: (n, o) => {
        calls.push(`remove:${n}:${o.removeVolume}`);
        return Promise.resolve();
      },
      removeVolumes: (names) => {
        calls.push(`removeVolumes:${names.join(",")}`);
        return Promise.resolve();
      },
      list: () => Promise.resolve([]),
    };
  }

  it("ensureInstance delegates to the runtime", async () => {
    const calls: string[] = [];
    await new DockerInstanceRuntime(recordingRuntime(calls)).ensureInstance(
      INSTANCE,
    );
    expect(calls).toEqual(["ensureInstance:p0rt1on-instance-alice"]);
  });

  it("ensureRunning addresses the container by instance name", async () => {
    const calls: string[] = [];
    await new DockerInstanceRuntime(recordingRuntime(calls)).ensureRunning(
      "alice",
    );
    expect(calls).toEqual(["ensureStarted:p0rt1on-instance-alice"]);
  });

  it("stop/removeInstance address the container by instance name", async () => {
    const calls: string[] = [];
    const rt = new DockerInstanceRuntime(recordingRuntime(calls));
    await rt.stopInstance("alice");
    await rt.removeInstance("alice", { removeVolumes: true });
    expect(calls).toEqual([
      "stop:p0rt1on-instance-alice",
      "remove:p0rt1on-instance-alice:true",
      // Current single volume + the legacy 4-volume names (pre-SNSD
      // instances) + state — removeVolumes ignores whichever are absent.
      "removeVolumes:p0rt1on-data-alice,p0rt1on-data-alice-1," +
      "p0rt1on-data-alice-2,p0rt1on-data-alice-3,p0rt1on-data-alice-4," +
      "p0rt1on-tsstate-alice",
    ]);
  });
});
