import "server-only";

import { isAuthError, isAuthSessionMissingError, type User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getPosContext() {
  const supabase = await createSupabaseServerClient();
  const unauthenticated = { supabase, user: null, employee: null };
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    if (isUnauthenticatedAuthError(sessionError)) return unauthenticated;
    throw sessionError;
  }
  if (!sessionData.session) return unauthenticated;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) {
    if (isUnauthenticatedAuthError(userError)) return unauthenticated;
    throw userError;
  }
  if (!userData.user) return unauthenticated;

  const { data: profiles, error } = await supabase.rpc("current_employee_profile");
  if (error) throw error;
  return { supabase, user: userData.user, employee: profiles?.[0] ?? null };
}

function isUnauthenticatedAuthError(error: unknown) {
  return isAuthSessionMissingError(error) ||
    (isAuthError(error) && (error.status === 401 || error.status === 403));
}

export function isEmployee(
  user: User | null,
  employee: { id: string; role: string } | null,
): employee is { id: string; role: string } {
  return Boolean(user && employee);
}

export function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "เกิดข้อผิดพลาดในการประมวลผลคำขอ";
}

export function validUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validSatang(value: unknown, allowZero = false): value is number {
  return Number.isSafeInteger(value) && (allowZero ? (value as number) >= 0 : (value as number) > 0);
}

export function jsonError(error: unknown, status = 400) {
  return Response.json({ error: errorMessage(error) }, { status });
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
