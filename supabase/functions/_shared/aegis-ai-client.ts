const DEFAULT_AI_WORKER_URL = "https://aegispay-web.aegispay.workers.dev/api/ai";
const MAX_ANSWER_LENGTH = 2_400;
const REQUEST_TIMEOUT_MS = 13_000;

export type AegisAIRequest = {
  authorizationToken: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  context: unknown;
};

export async function requestAegisAI(
  input: AegisAIRequest,
  options: { fetcher?: typeof fetch; url?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const token = String(input.authorizationToken || "").trim();
  if (!token) throw new Error("AI request requires an authenticated user token.");

  const fetcher = options.fetcher || fetch;
  let response: Response;
  try {
    response = await fetcher(options.url || DEFAULT_AI_WORKER_URL, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        message: String(input.message || "").trim().slice(0, 1000),
        history: Array.isArray(input.history) ? input.history.slice(-6) : [],
        context: input.context,
      }),
      signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (_) {
    throw new Error("AI provider request failed or timed out.");
  }

  if (!response.ok) {
    // Never echo upstream body, prompt, request headers, or authentication details.
    throw new Error("AI provider returned HTTP " + response.status + ".");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (_) {
    throw new Error("AI provider returned an invalid response.");
  }
  const answer = data && typeof data === "object"
    ? String((data as { answer?: unknown }).answer || "").trim().slice(0, MAX_ANSWER_LENGTH)
    : "";
  if (!answer) throw new Error("AI provider returned an empty answer.");
  return answer;
}
