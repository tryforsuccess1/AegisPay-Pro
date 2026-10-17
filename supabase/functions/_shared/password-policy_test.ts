import { assertEquals } from "jsr:@std/assert@1";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordPolicyError } from "./password-policy.ts";

Deno.test("password policy rejects passwords shorter than 12 characters", () => {
  assertEquals(MIN_PASSWORD_LENGTH, 12);
  assertEquals(passwordPolicyError("shortpass"), "Password must contain 12 to 128 characters.");
});

Deno.test("password policy accepts exactly 12 characters", () => {
  assertEquals(passwordPolicyError("A1234567890b"), null);
});

Deno.test("password policy accepts exactly 128 characters", () => {
  assertEquals(passwordPolicyError("A".repeat(MAX_PASSWORD_LENGTH)), null);
});

Deno.test("password policy rejects passwords longer than 128 characters", () => {
  assertEquals(passwordPolicyError("A".repeat(MAX_PASSWORD_LENGTH + 1)), "Password must contain 12 to 128 characters.");
});
