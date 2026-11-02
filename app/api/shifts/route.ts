import { apiFailure, logRpcFailure, withRequestId } from "@/lib/api-errors";
import { POS_REGISTER_ID } from "@/lib/pos-constants";
import { getPosContext, isEmployee } from "@/lib/pos-server";
import { calculateExpectedCash } from "@/lib/financial";

export const dynamic = "force-dynamic";

function sum(rows: Array<{ amount_satang: number }>) {
  return rows.reduce((total, row) => total + row.amount_satang, 0);
}

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

    const [paymentsResult, refundsResult, movementsResult, ordersResult] = await Promise.all([
      supabase.from("payments").select("method, amount_satang").eq("shift_id", activeShift.id),
      supabase.from("refunds").select("channel, amount_satang").eq("shift_id", activeShift.id),
      supabase.from("cash_movements").select("type, channel, amount_satang").eq("shift_id", activeShift.id),
      supabase.from("orders").select("id, discount_satang, tax_satang").eq("shift_id", activeShift.id).not("paid_at", "is", null),
    ]);
    const failure = [paymentsResult.error, refundsResult.error, movementsResult.error, ordersResult.error].find(Boolean);
    if (failure) throw failure;
    const payments = paymentsResult.data ?? [];
    const refunds = refundsResult.data ?? [];
    const movements = movementsResult.data ?? [];
    const cashSales = sum(payments.filter((payment) => payment.method === "cash"));
    const transferSales = sum(payments.filter((payment) => payment.method === "bank_transfer"));
    const cashRefunds = sum(refunds.filter((refund) => refund.channel === "cash"));
    const cashIn = sum(movements.filter((movement) => movement.type === "in" && movement.channel === "cash"));
    const cashOut = sum(movements.filter((movement) => movement.type === "out" && movement.channel === "cash"));
    const { expectedCash } = calculateExpectedCash({
      openingCash: activeShift.opening_cash_satang,
      cashSales,
      cashRefunds,
      cashIn,
      cashOut,
    });

    return withRequestId(Response.json({
      activeShift,
      preview: {
        opening_cash_satang: activeShift.opening_cash_satang,
        cash_sales_satang: cashSales,
        cash_refunds_satang: cashRefunds,
        cash_in_satang: cashIn,
        cash_out_satang: cashOut,
        expected_cash_satang: expectedCash,
        transfer_sales_satang: transferSales,
        discount_satang: (ordersResult.data ?? []).reduce((total, order) => total + order.discount_satang, 0),
        tax_satang: (ordersResult.data ?? []).reduce((total, order) => total + order.tax_satang, 0),
        refunds_satang: sum(refunds),
        net_sales_satang: cashSales + transferSales - sum(refunds),
        order_count: (ordersResult.data ?? []).length,
      },
      closings: closingsWithNames,
    }), requestId);
  } catch (error) {
    return withRequestId(apiFailure(error, "api/shifts GET", requestId), requestId);
  }
}
