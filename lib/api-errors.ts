import { isAuthError, isAuthSessionMissingError } from "@supabase/supabase-js";

export function isUnauthenticatedAuthError(error: unknown) {
  return isAuthSessionMissingError(error) ||
    (isAuthError(error) && (error.status === 401 || error.status === 403));
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "เกิดข้อผิดพลาดในการประมวลผลคำขอ";
}

export function apiFailure(error: unknown, route: string) {
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
  console.error(`[${route}] Unexpected request failure`, { name, code });
  return Response.json({ error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง" }, { status: 500 });
}
