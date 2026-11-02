import { isAuthError, isAuthSessionMissingError } from "@supabase/supabase-js";

const loggedErrors = new WeakSet<object>();

function markLogged(error: unknown) {
  if (typeof error === "object" && error !== null) loggedErrors.add(error);
}

function wasLogged(error: unknown) {
  return typeof error === "object" && error !== null && loggedErrors.has(error);
}

export function isUnauthenticatedAuthError(error: unknown) {
  return isAuthSessionMissingError(error) ||
    (isAuthError(error) && (error.status === 401 || error.status === 403));
}

export function withRequestId(response: Response, requestId?: string) {
  if (requestId) response.headers.set("x-request-id", requestId);
  return response;
}

function redactDiagnostic(value: string | undefined) {
  return value
    ?.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, "[REDACTED TOKEN]")
    .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+\b/g, "[REDACTED KEY]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]")
    .slice(0, 500);
}

export function logRpcFailure(
  route: string,
  name: string,
  error: unknown,
  requestId?: string,
  diagnosticCategory?: string,
  projectHost?: string,
) {
  markLogged(error);
  console.error(`[${route}] Supabase RPC ${name} failed`, {
    requestId,
    diagnosticCategory,
    projectHost,
    code: diagnosticField(error, "code"),
    message: redactDiagnostic(diagnosticField(error, "message")),
    details: redactDiagnostic(diagnosticField(error, "details")),
    hint: redactDiagnostic(diagnosticField(error, "hint")),
  });
}

export function logTaxConfigurationRead(
  status: "row_returned" | "no_row_safe_fallback",
  requestId: string,
  projectHost: string,
) {
  const log = status === "row_returned" ? console.info : console.warn;
  log("[api/pos GET] Tax configuration read", { requestId, status, projectHost });
}

export function logTaxConfigurationVisibility(
  status: "authenticated_direct_select_row_returned" | "authenticated_direct_select_no_visible_row",
  requestId: string,
  projectHost: string,
) {
  const log = status.endsWith("no_visible_row") ? console.warn : console.info;
  log("[api/pos GET] Authenticated tax table visibility", { requestId, status, projectHost });
}

function diagnosticField(error: unknown, key: string) {
  if (typeof error !== "object" || error === null || !(key in error)) return undefined;
  const value = error[key as keyof typeof error];
  return typeof value === "string" ? value : undefined;
}

export function logQueryFailure(
  route: string,
  name: string,
  error: unknown,
  requestId?: string,
  diagnosticCategory?: string,
  projectHost?: string,
) {
  markLogged(error);
  console.error(`[${route}] Supabase query ${name} failed`, {
    requestId,
    diagnosticCategory,
    projectHost,
    code: diagnosticField(error, "code"),
    message: redactDiagnostic(diagnosticField(error, "message")),
    details: redactDiagnostic(diagnosticField(error, "details")),
    hint: redactDiagnostic(diagnosticField(error, "hint")),
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "เกิดข้อผิดพลาดในการประมวลผลคำขอ";
}

export function apiFailure(error: unknown, route: string, requestId?: string) {
  if (isUnauthenticatedAuthError(error)) {
    return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  }

  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
  if (code === "42501") {
    return Response.json({ error: "ไม่มีสิทธิ์ดำเนินการนี้" }, { status: 403 });
  }
  if (code === "P0001") {
    return Response.json({ error: errorMessage(error) }, { status: 400 });
  }
  if (code === "23505") {
    return Response.json({ error: "รายการนี้ถูกบันทึกไปแล้ว" }, { status: 409 });
  }

  const name = error instanceof Error ? error.name : "UnknownError";
  const message = typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
    ? redactDiagnostic(error.message)
    : undefined;
  if (!wasLogged(error)) {
    console.error(`[${route}] Unexpected request failure`, { requestId, name, code, message });
  }
  return Response.json({ error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง" }, { status: 500 });
}
