export type AuthLoginErrorLike = {
  code?: unknown;
  message?: unknown;
} | null | undefined;

export type AuthLoginFailure = {
  error: string;
  code: "CAPTCHA_VERIFICATION_FAILED" | "AUTH_RATE_LIMITED" | "INVALID_CREDENTIALS";
  status: 400 | 429 | 401;
};

/**
 * Classify only safe, user-actionable Auth service failures.
 * Credential and unknown-user failures deliberately share one generic result
 * to avoid revealing whether a username or email exists.
 */
export function classifyAuthLoginError(error: AuthLoginErrorLike): AuthLoginFailure {
  const code = String(error?.code ?? "").trim().toLowerCase();
  const message = String(error?.message ?? "").trim().toLowerCase();
  const searchable = code + " " + message;

  if (/(captcha|turnstile|bot verification)/.test(searchable)) {
    return {
      error: "Security verification could not be validated. Refresh the page, complete the Cloudflare check, and try again.",
      code: "CAPTCHA_VERIFICATION_FAILED",
      status: 400,
    };
  }

  if (/(over_request_rate_limit|too_many_requests|rate[- ]limit|too many requests)/.test(searchable)) {
    return {
      error: "Too many login attempts. Please wait a few minutes before trying again.",
      code: "AUTH_RATE_LIMITED",
      status: 429,
    };
  }

  return {
    error: "Invalid username or password.",
    code: "INVALID_CREDENTIALS",
    status: 401,
  };
}
