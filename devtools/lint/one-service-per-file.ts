/**
 * Deno lint plugin: `one-service-per-file`.
 *
 * A "service" is a top-level class whose name ends in `Service` or
 * `ServiceImpl` (e.g. FriendServiceImpl, ProvisioningService, AuditServiceImpl).
 * A file may declare at most ONE service class, so each service can be found,
 * imported, tested, and diffed on its own — no "pile of services in one file"
 * (the old DbServices.ts, which stacked an orchestrator on top of three thin
 * query wrappers). This holds even for one-line wrappers: each gets its file.
 *
 * The file's kept service is the one whose name matches the filename
 * (`AuditService.ts` → `AuditServiceImpl`), else the first declared; every other
 * service class is flagged and must move to its own file. Non-service classes (a
 * name not ending in Service/ServiceImpl) are ignored, so a service may sit next
 * to a small helper class.
 *
 * Exemptions: test files and test-helpers may define whatever fakes they need.
 */

const EXEMPT = [".test.", "/test-helpers/"];

function exempt(filename: string): boolean {
  return EXEMPT.some((frag) => filename.includes(frag));
}

const SERVICE = /Service(Impl)?$/;

function basename(filename: string): string {
  const file = filename.split("/").pop() ?? filename;
  return file.replace(/\.(ts|tsx|js|jsx)$/, "");
}

type Svc = { name: string; node: Deno.lint.Node };

export default {
  name: "one-service-per-file",
  rules: {
    "one-service-per-file": {
      create(context) {
        if (exempt(context.filename)) return {};
        const base = basename(context.filename);
        const services: Svc[] = [];

        return {
          "ClassDeclaration"(node: Deno.lint.ClassDeclaration) {
            // Top-level classes only — `class X` or `export class X`.
            const parent = node.parent?.type;
            if (
              !node.id ||
              (parent !== "Program" &&
                parent !== "ExportNamedDeclaration" &&
                parent !== "ExportDefaultDeclaration")
            ) return;
            if (SERVICE.test(node.id.name)) {
              services.push({ name: node.id.name, node });
            }
          },
          "Program:exit"() {
            if (services.length < 2) return;
            // Keep the service named after the file (Impl suffix optional); else
            // the first declared. Every other service must move to its own file.
            const kept =
              services.find((sv) =>
                sv.name === base || sv.name.replace(/Impl$/, "") === base
              ) ?? services[0];
            for (const sv of services) {
              if (sv === kept) continue;
              context.report({
                node: sv.node,
                message:
                  `"${sv.name}" is a second service in this file — give each service its own file (e.g. ${
                    sv.name.replace(/Impl$/, "")
                  }.ts).`,
              });
            }
          },
        };
      },
    },
  },
} satisfies Deno.lint.Plugin;
