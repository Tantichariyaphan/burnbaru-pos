import { apiFailure, logRpcFailure, withRequestId } from "@/lib/api-errors";
import { POS_REGISTER_ID } from "@/lib/pos-constants";
import { getPosContext, isEmployee } from "@/lib/pos-server";
import { calculateShiftReconciliation } from "@/lib/financial";
import { fetchAllPages } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const { supabase, user, employee } = await getPosContext("api/shifts GET", requestId);
    if (!user) return withRequestId(Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 }), requestId);
    if (!isEmployee(user, employee)) return withRequestId(Response.json({ error: "ไม่มีสิทธิ์ดูข้อมูลกะ" }, { status: 403 }), requestId);

    const [{ data: activeShift, error: shiftError }, { data: closings, error: closingError }] = await Promise.all([
      supabase.from("shifts").select("id, register_id, opening_cash_satang, opened_at, opened_by")
        .eq("register_id", POS_REGISTER_ID).eq("status", "open").maybeSingle(),
      supabase.from("shift_closings").select("*")
        .order("closed_at", { ascending: false }).limit(50),
    ]);
    if (shiftError) throw shiftError;
    if (closingError) throw closingError;
    const { data: directory, error: directoryError } = await supabase.rpc("employee_directory");
    if (directoryError) {
      logRpcFailure("api/shifts GET", "employee_directory", directoryError, requestId);
      throw directoryError;
    }
    const employeeNames = new Map<string, string>((directory ?? []).map((person: { id: string; name: string }) => [person.id, person.name]));
    const closingsWithNames = (closings ?? []).map((closing) => ({
      ...closing,
      employee: { name: employeeNames.get(String(closing.closed_by)) ?? "—" },
    }));
    if (!activeShift) return withRequestId(Response.json({ activeShift: null, preview: null, closings: closingsWithNames }), requestId);

    const [payments, refunds, movements, orders] = await Promise.all([
      fetchAllPages((from, to) => supabase.from("payments")
        .select("method, amount_satang").eq("shift_id", activeShift.id)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => supabase.from("refunds")
        .select("channel, amount_satang").eq("shift_id", activeShift.id)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => supabase.from("cash_movements")
        .select("type, channel, amount_satang").eq("shift_id", activeShift.id)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
      fetchAllPages((from, to) => supabase.from("orders").select("id, discount_satang, tax_satang")
        .eq("shift_id", activeShift.id).in("status", ["preparing", "completed"]).not("paid_at", "is", null)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)),
    ]);
    const reconciliation = calculateShiftReconciliation(
      activeShift.opening_cash_satang,
      payments,
      refunds,
      movements,
    );

    return withRequestId(Response.json({
      activeShift,
      preview: {
        opening_cash_satang: activeShift.opening_cash_satang,
        cash_sales_satang: reconciliation.cashSales,
        cash_refunds_satang: reconciliation.cashRefunds,
        cash_in_satang: reconciliation.cashIncome,
        cash_out_satang: reconciliation.cashExpenses,
        expected_cash_satang: reconciliation.expectedCash,
        transfer_sales_satang: reconciliation.transferSales,
        bank_income_satang: reconciliation.bankIncome,
        bank_expenses_satang: reconciliation.bankExpenses,
        discount_satang: orders.reduce((total, order) => total + order.discount_satang, 0),
        tax_satang: orders.reduce((total, order) => total + order.tax_satang, 0),
        refunds_satang: reconciliation.totalRefunds,
        net_sales_satang: reconciliation.netSales,
        order_count: orders.length,
      },
      closings: closingsWithNames,
    }), requestId);
  } catch (error) {
    return withRequestId(apiFailure(error, "api/shifts GET", requestId), requestId);
  }
}
