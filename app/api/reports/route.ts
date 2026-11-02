import { apiFailure, logRpcFailure } from "@/lib/api-errors";
import { getPosContext, isEmployee } from "@/lib/pos-server";
import { calculateMovementTotals, calculateNetSales, calculateRefundTotalsByPaymentMethod } from "@/lib/financial";
import { fetchAllPages } from "@/lib/supabase-pagination";

export const dynamic = "force-dynamic";

type TotalRow = { name: string; total_satang: number; quantity?: number; count?: number };

function addTotal(rows: Map<string, TotalRow>, name: string, total: number, quantity = 0) {
  const row = rows.get(name) ?? { name, total_satang: 0, quantity: 0, count: 0 };
  row.total_satang += total;
  row.quantity = (row.quantity ?? 0) + quantity;
  row.count = (row.count ?? 0) + 1;
  rows.set(name, row);
}

export async function GET(request: Request) {
  try {
    const { supabase, user, employee } = await getPosContext("api/reports GET");
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "ไม่มีสิทธิ์ดูรายงาน" }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if ((from && (!fromDate || Number.isNaN(fromDate.getTime()))) ||
      (to && (!toDate || Number.isNaN(toDate.getTime())))) {
      return Response.json({ error: "ช่วงวันที่รายงานไม่ถูกต้อง" }, { status: 400 });
    }
    const start = (fromDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1)).toISOString();
    const end = (toDate ?? new Date()).toISOString();
    if (start > end) return Response.json({ error: "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด" }, { status: 400 });
    const [orders, refundsInPeriod, receipts, movements, closings] = await Promise.all([
      fetchAllPages((pageFrom, pageTo) => supabase.from("orders")
        .select("id, order_no, status, subtotal_satang, discount_satang, tax_satang, total_satang, created_by, payment_method, paid_at, order_items(name_snapshot, category_name_snapshot, quantity, line_total_satang), payments(method, amount_satang)")
        .gte("paid_at", start).lte("paid_at", end).in("status", ["preparing", "completed"]).not("paid_at", "is", null)
        .order("paid_at", { ascending: true }).order("id", { ascending: true }).range(pageFrom, pageTo)),
      fetchAllPages((pageFrom, pageTo) => supabase.from("refunds")
        .select("channel, sale_payment_method, amount_satang, created_at")
        .gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(pageFrom, pageTo)),
      fetchAllPages((pageFrom, pageTo) => supabase.from("receipts").select("id, receipt_no, order_id, created_at")
        .gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(pageFrom, pageTo)),
      fetchAllPages((pageFrom, pageTo) => supabase.from("cash_movements")
        .select("id, type, channel, amount_satang, reason, created_at")
        .gte("created_at", start).lte("created_at", end)
        .order("created_at", { ascending: true }).order("id", { ascending: true }).range(pageFrom, pageTo)),
      fetchAllPages((pageFrom, pageTo) => supabase.from("shift_closings").select("*")
        .gte("closed_at", start).lte("closed_at", end)
        .order("closed_at", { ascending: true }).order("id", { ascending: true }).range(pageFrom, pageTo)),
    ]);

    const paidOrders = orders.filter((order) => order.payments?.length);
    const { data: employees, error: employeesError } = await supabase.rpc("employee_directory");
    if (employeesError) {
      logRpcFailure("api/reports GET", "employee_directory", employeesError);
      throw employeesError;
    }
    const employeeNames = new Map<string, string>((employees ?? []).map((item: { id: string; name: string }) => [item.id, item.name]));
    const paymentTotals = new Map<string, TotalRow>();
    const productTotals = new Map<string, TotalRow>();
    const categoryTotals = new Map<string, TotalRow>();
    const employeeTotals = new Map<string, TotalRow>();
    for (const order of paidOrders) {
      for (const payment of order.payments ?? []) addTotal(paymentTotals, payment.method, payment.amount_satang);
      addTotal(employeeTotals, employeeNames.get(String(order.created_by)) ?? "ไม่ระบุ", order.total_satang);
      for (const item of order.order_items ?? []) {
        addTotal(productTotals, item.name_snapshot, item.line_total_satang, item.quantity);
        addTotal(categoryTotals, item.category_name_snapshot || "ไม่ระบุหมวดหมู่", item.line_total_satang, item.quantity);
      }
    }

    const paidAmounts = paidOrders.flatMap((order) => (order.payments ?? []).map((payment) => payment.amount_satang));
    const refundAmounts = refundsInPeriod.map((refund) => refund.amount_satang);
    const grossSales = paidAmounts.reduce((total, amount) => total + amount, 0);
    const totalRefunds = refundAmounts.reduce((total, amount) => total + amount, 0);
    const refundsByPaymentMethod = calculateRefundTotalsByPaymentMethod(refundsInPeriod);
    const movementTotals = calculateMovementTotals(movements);

    return Response.json({
      range: { from: start, to: end },
      summary: {
        order_count: paidOrders.length,
        gross_sales_satang: grossSales,
        refunds_satang: totalRefunds,
        net_sales_satang: calculateNetSales(paidAmounts, refundAmounts),
        discounts_satang: paidOrders.reduce((total, order) => total + order.discount_satang, 0),
        tax_satang: paidOrders.reduce((total, order) => total + order.tax_satang, 0),
        receipt_count: receipts.length,
        cash_income_satang: movementTotals.cashIncome,
        cash_expenses_satang: movementTotals.cashExpenses,
        bank_income_satang: movementTotals.bankIncome,
        bank_expenses_satang: movementTotals.bankExpenses,
      },
      cash_movements: movements,
      shift_closings: closings.map((closing) => ({
        ...closing,
        employee: { name: employeeNames.get(String(closing.closed_by)) ?? "—" },
      })),
      by_product: [...productTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_category: [...categoryTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_employee: [...employeeTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_payment_method: ["cash", "bank_transfer"].map((method) => {
        const total = paymentTotals.get(method)?.total_satang ?? 0;
        const refunded = method === "cash" ? refundsByPaymentMethod.cash : refundsByPaymentMethod.bankTransfer;
        return { name: method, total_satang: total, refunds_satang: refunded, net_satang: total - refunded };
      }),
    });
  } catch (error) {
    return apiFailure(error, "api/reports GET");
  }
}
