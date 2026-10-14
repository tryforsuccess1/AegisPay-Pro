import {
  assertPasswordNotPwned,
  PasswordSecurityUnavailableError,
  PwnedPasswordError,
} from "./pwned-passwords.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function sha1Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

Deno.test("breached passwords are rejected using only a five-character hash prefix", async () => {
  const password = "AegisPay-Test-Password-That-Is-Breached!";
  const fullHash = await sha1Hex(password);
  let requestedUrl = "";
  let addPadding = "";

  let caught: unknown;
  try {
    await assertPasswordNotPwned(password, async (input, init) => {
      requestedUrl = String(input);
      addPadding = new Headers(init?.headers).get("Add-Padding") || "";
      return new Response(fullHash.slice(5) + ":12\r\n", { status: 200 });
    });
  } catch (error) {
    caught = error;
  }

  assert(caught instanceof PwnedPasswordError, "A password found in the range response must be rejected.");
  assert(requestedUrl === "https://api.pwnedpasswords.com/range/" + fullHash.slice(0, 5),
    "Only the first five hash characters should be sent to the range API.");
  assert(!requestedUrl.includes(password) && !requestedUrl.includes(fullHash),
    "The raw password and full hash must not be sent to the provider.");
  assert(addPadding.toLowerCase() === "true", "The privacy-padding header should be enabled.");
});

Deno.test("passwords absent from the range response are accepted", async () => {
  const password = "AegisPay-Test-Password-Not-Breached-942";
  const fullHash = await sha1Hex(password);
  const otherSuffix = fullHash.slice(5) === "F".repeat(35) ? "0".repeat(35) : "F".repeat(35);
  await assertPasswordNotPwned(password, async () =>
    new Response(otherSuffix + ":7\r\n", { status: 200 })
  );
});

Deno.test("password screening fails closed when the provider is unavailable", async () => {
  let caught: unknown;
  try {
    await assertPasswordNotPwned("AegisPay-Test-Password-Provider-Down", async () =>
      new Response("temporarily unavailable", { status: 503 })
    );
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof PasswordSecurityUnavailableError,
    "A provider failure must stop signup/password changes rather than fail open.");
});
