export class PwnedPasswordError extends Error {
  constructor() {
    super("This password appears in known data breaches. Please choose a different password.");
    this.name = "PwnedPasswordError";
  }
}

export class PasswordSecurityUnavailableError extends Error {
  constructor() {
    super("Password security verification is temporarily unavailable.");
    this.name = "PasswordSecurityUnavailableError";
  }
}

/**
 * Checks a password against the Pwned Passwords range API.
 * Only the first five SHA-1 hex characters leave this service; the password
 * and the remaining hash suffix are never sent to the provider.
 *
 * Fail closed if the provider is unavailable so new passwords are not
 * accepted without the requested security check.
 */
export async function assertPasswordNotPwned(
  password: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const bytes = new TextEncoder().encode(password);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  const fullHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetcher("https://api.pwnedpasswords.com/range/" + prefix, {
      method: "GET",
      headers: { "Add-Padding": "true", "User-Agent": "AegisPay-Password-Security" },
      signal: controller.signal,
    });
    if (!response.ok) throw new PasswordSecurityUnavailableError();

    const rangeBody = await response.text();
    const entries = rangeBody.split(/\r?\n/);
    for (const entry of entries) {
      const [foundSuffix, countText] = entry.trim().split(":");
      if (foundSuffix?.toUpperCase() === suffix && Number(countText) > 0) {
        throw new PwnedPasswordError();
      }
    }
  } catch (error) {
    if (error instanceof PwnedPasswordError || error instanceof PasswordSecurityUnavailableError) throw error;
    throw new PasswordSecurityUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}
