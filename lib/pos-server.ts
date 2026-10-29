import "server-only";

import { type User } from "@supabase/supabase-js";
import { isUnauthenticatedAuthError, logRpcFailure } from "@/lib/api-errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getPosContext(route = "API request") {
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
  if (error) {
    logRpcFailure(route, "current_employee_profile", error);
    throw error;
  }
  return { supabase, user: userData.user, employee: profiles?.[0] ?? null };
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
