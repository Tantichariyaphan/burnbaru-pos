import { getPosContext, isEmployee, jsonError } from "@/lib/pos-server";
import { calculateNetSales } from "@/lib/financial";

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
    const { supabase, user, employee } = await getPosContext();
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "ไม่มีสิทธิ์ดูรายงาน" }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const start = from && !Number.isNaN(Date.parse(from)) ? new Date(from).toISOString() : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to).toISOString() : new Date().toISOString();
    const [{ data: orders, error: ordersError }, { data: refunds, error: refundsError }, { data: receipts, error: receiptsError }] = await Promise.all([
      supabase.from("orders")
        .select("id, order_no, subtotal_satang, discount_satang, tax_satang, total_satang, created_by, payment_method, paid_at, order_items(name_snapshot, category_name_snapshot, quantity, line_total_satang), payments(method, amount_satang)")
        .gte("paid_at", start).lte("paid_at", end).not("paid_at", "is", null).order("paid_at", { ascending: false }),
      supabase.from("refunds").select("channel, amount_satang, created_at")
        .gte("created_at", start).lte("created_at", end),
      supabase.from("receipts").select("id, receipt_no, order_id, created_at")
        .gte("created_at", start).lte("created_at", end),
    ]);
    if (ordersError) throw ordersError;
    if (refundsError) throw refundsError;
    if (receiptsError) throw receiptsError;

    const paidOrders = orders ?? [];
    const { data: employees, error: employeesError } = await supabase.rpc("employee_directory");
    if (employeesError) throw employeesError;
    const employeeNames = new Map<string, string>((employees ?? []).map((item: { id: string; name: string }) => [item.id, item.name]));
    const refundsInPeriod = refunds ?? [];
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
    const cashRefunds = refundsInPeriod.filter((refund) => refund.channel === "cash").reduce((total, refund) => total + refund.amount_satang, 0);
    const transferRefunds = refundsInPeriod.filter((refund) => refund.channel === "bank_transfer").reduce((total, refund) => total + refund.amount_satang, 0);

    return Response.json({
      range: { from: start, to: end },
      summary: {
        order_count: paidOrders.length,
        gross_sales_satang: grossSales,
        refunds_satang: totalRefunds,
        net_sales_satang: calculateNetSales(paidAmounts, refundAmounts),
        discounts_satang: paidOrders.reduce((total, order) => total + order.discount_satang, 0),
        tax_satang: paidOrders.reduce((total, order) => total + order.tax_satang, 0),
        receipt_count: receipts?.length ?? 0,
      },
      by_product: [...productTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_category: [...categoryTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_employee: [...employeeTotals.values()].sort((a, b) => b.total_satang - a.total_satang),
      by_payment_method: ["cash", "bank_transfer"].map((method) => {
        const total = paymentTotals.get(method)?.total_satang ?? 0;
        const refunded = method === "cash" ? cashRefunds : transferRefunds;
        return { name: method, total_satang: total, refunds_satang: refunded, net_satang: total - refunded };
      }),
    });
  } catch (error) {
    return jsonError(error, 500);
  }
}
