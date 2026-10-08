import { AxiosError } from "axios";

// xero-node 13 serializes ApiError.generateError(), including credential-bearing
// request headers, before rejecting. Parse for inspection; never return the envelope.
function parsedError(error: unknown): unknown {
  if (typeof error !== "string" || error.length > 1_048_576) return error;
  try { return JSON.parse(error); } catch { return undefined; }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function safeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [redacted]")
    .replace(/\p{Cc}/gu, " ").slice(0, 512);
}

/** Extract only provider validation messages, never echoed records or headers. */
export function xeroValidationMessages(body: unknown): string[] {
  const root = object(body), messages: string[] = [];
  const add = (element: unknown) => {
    const item = object(element), errors = item?.ValidationErrors ?? item?.validationErrors;
    if (!Array.isArray(errors)) return;
    for (const error of errors.slice(0, 10)) {
      const entry = object(error), message = safeMessage(entry?.Message ?? entry?.message);
      if (message && !messages.includes(message) && messages.length < 10) messages.push(message);
    }
  };
  add(root);
  for (const key of ["Elements", "BankTransactions", "bankTransactions"]) {
    const elements = root?.[key];
    if (Array.isArray(elements)) for (const element of elements.slice(0, 50)) add(element);
  }
  return messages;
}

/** Normalize object and serialized SDK failures using a small return-field allowlist. */
export function xeroErrorDetails(error: unknown): { httpStatus?: number; providerMessage?: string; validationMessages: string[] } {
  const parsed = object(parsedError(error)), response = object(parsed?.response);
  const status = response?.statusCode ?? response?.status;
  const httpStatus = typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const body = response?.body ?? response?.data ?? parsed?.body;
  return { ...(httpStatus !== undefined ? { httpStatus,
    // Rebuild only the allowed provider response. A generic Error with an attached
    // status must not expose its arbitrary message, request or headers.
    providerMessage: formatError({ response: { statusCode: httpStatus, body,
      ...(hasInsufficientScope(body, response?.headers) ? { headers: { "www-authenticate": 'Bearer error="insufficient_scope"' } } : {}) } }) } : {}),
    validationMessages: xeroValidationMessages(body) };
}

interface XeroSdkProblem {
  title?: string;
  detail?: string;
  status?: number;
}

interface XeroSdkError {
  response: {
    statusCode: number;
    headers?: unknown;
    body?: {
      httpStatusCode?: string;
      problem?: XeroSdkProblem;
      Detail?: string;
    };
  };
}

function isXeroSdkError(error: unknown): error is XeroSdkError {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return false;
  return typeof (response as { statusCode?: unknown }).statusCode === "number";
}

function hasInsufficientScope(body: unknown, headers: unknown): boolean {
  const value = object(body), problem = object(value?.problem), responseHeaders = object(headers);
  const challenge = Object.entries(responseHeaders ?? {}).find(([name]) => name.toLowerCase() === "www-authenticate")?.[1];
  return [value?.Detail, value?.detail, value?.error, value?.error_description, problem?.detail, problem?.title, challenge]
    .some(field => typeof field === "string" && /\binsufficient_scope\b/i.test(field));
}

function formatHttpStatus(status: number, insufficientScope = false): string {
  if ((status === 401 || status === 403) && insufficientScope) return "Xero OAuth consent is missing required endpoint scopes. Token refresh cannot add scopes; request owner-approved consent renewal before retrying.";
  switch (status) {
    case 401:
      return "Authentication failed. Please check your Xero credentials.";
    case 403:
      return "You don't have permission to access this resource in Xero.";
    case 404:
      return "The requested resource was not found in Xero.";
    case 429:
      return "Too many requests to Xero. Please try again in a moment.";
    default:
      return "";
  }
}

/**
 * Format error messages for return to the LLM.
 *
 * Never stringify unknown error objects — the xero-node SDK rejects with an
 * object or serialized envelope whose request headers contain the
 * caller's Bearer token. Whitelist the fields we extract so secrets never
 * reach the response.
 */
export function formatError(error: unknown): string {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const detail = safeMessage(error.response?.data?.Detail);

    if (status !== undefined) {
      const mapped = formatHttpStatus(status, hasInsufficientScope(error.response?.data, error.response?.headers));
      if (mapped) return mapped;
    }
    return detail || "An error occurred while communicating with Xero.";
  }

  const parsed = parsedError(error);
  if (isXeroSdkError(parsed)) {
    const status = parsed.response.statusCode;
    const mapped = formatHttpStatus(status, hasInsufficientScope(parsed.response.body, parsed.response.headers));
    if (mapped) return mapped;

    const body = parsed.response.body;
    const problem = body?.problem;
    const title = safeMessage(problem?.title ?? body?.httpStatusCode) ?? "HTTP error";
    const detail = safeMessage(problem?.detail ?? body?.Detail);
    return detail ? `${status} ${title}: ${detail}` : `${status} ${title}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "An unexpected error occurred while communicating with Xero.";
}
