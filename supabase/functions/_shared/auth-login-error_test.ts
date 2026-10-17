import { assertEquals } from "jsr:@std/assert@1.0.14";
import { classifyAuthLoginError } from "./auth-login-error.ts";

Deno.test("classifies CAPTCHA failures separately from invalid credentials", () => {
  assertEquals(classifyAuthLoginError({ code: "captcha_failed", message: "captcha challenge failed" }), {
    error: "Security verification could not be validated. Refresh the page, complete the Cloudflare check, and try again.",
    code: "CAPTCHA_VERIFICATION_FAILED",
    status: 400,
  });
  assertEquals(classifyAuthLoginError({ message: "Turnstile verification failed" }).code, "CAPTCHA_VERIFICATION_FAILED");
});

Deno.test("classifies upstream auth throttling as a retryable rate limit", () => {
  const result = classifyAuthLoginError({ code: "over_request_rate_limit", message: "Too many requests" });
  assertEquals(result.code, "AUTH_RATE_LIMITED");
  assertEquals(result.status, 429);
});

Deno.test("keeps credential and unknown-account errors generic", () => {
  const wrongPassword = classifyAuthLoginError({ code: "invalid_credentials", message: "Invalid login credentials" });
  const unknownAccount = classifyAuthLoginError(null);
  assertEquals(wrongPassword, { error: "Invalid username or password.", code: "INVALID_CREDENTIALS", status: 401 });
  assertEquals(unknownAccount, wrongPassword);
});
