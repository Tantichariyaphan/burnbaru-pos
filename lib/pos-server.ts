import "server-only";

import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getPosContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) return { supabase, user: null, employee: null };

  const { data: employee, error } = await supabase
    .from("employees")
    .select("id, name, email, role, active")
    .eq("auth_user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  return { supabase, user, employee };
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
