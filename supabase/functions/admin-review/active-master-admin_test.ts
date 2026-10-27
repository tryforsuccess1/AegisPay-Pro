import { assertEquals } from "jsr:@std/assert@1";
import { isActiveMasterAdmin } from "./active-master-admin.ts";

Deno.test("allows ACTIVE and NORMAL Master Admin accounts", () => {
  assertEquals(isActiveMasterAdmin({ role: "MASTER ADMIN", status: "ACTIVE" }), true);
  assertEquals(isActiveMasterAdmin({ role: "MASTER ADMIN", status: "NORMAL" }), true);
});

Deno.test("normalizes role and status casing and whitespace", () => {
  assertEquals(isActiveMasterAdmin({ role: " master admin ", status: " active " }), true);
});

Deno.test("rejects non-admin roles even when active", () => {
  assertEquals(isActiveMasterAdmin({ role: "USER", status: "ACTIVE" }), false);
  assertEquals(isActiveMasterAdmin({ role: "ADMIN", status: "ACTIVE" }), false);
});

Deno.test("fails closed for inactive, unknown, or blocked statuses", () => {
  for (const status of ["", "INACTIVE", "PENDING", "BLOCKED", "SUSPENDED", "DELETED", "FROZEN"]) {
    assertEquals(isActiveMasterAdmin({ role: "MASTER ADMIN", status }), false, `status ${status}`);
  }
  assertEquals(isActiveMasterAdmin({ role: "MASTER ADMIN" }), false);
});

Deno.test("fails closed for missing or malformed actors", () => {
  assertEquals(isActiveMasterAdmin(undefined), false);
  assertEquals(isActiveMasterAdmin(null), false);
  assertEquals(isActiveMasterAdmin({}), false);
  assertEquals(isActiveMasterAdmin({ status: "ACTIVE" }), false);
});
