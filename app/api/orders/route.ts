import { errorMessage, getPosContext, isEmployee, jsonError, validSatang, validUuid } from "@/lib/pos-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user, employee } = await getPosContext();
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "ไม่มีสิทธิ์ดูรายการออเดอร์" }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const orderId = params.get("orderId");
    if (orderId) {
      if (!validUuid(orderId)) return Response.json({ error: "รหัสออเดอร์ไม่ถูกต้อง" }, { status: 400 });
      const { data: order, error } = await supabase.from("orders")
        .select("*, order_items(*), payments(*), receipts(*), refunds(*)")
        .eq("id", orderId).maybeSingle();
      if (error) throw error;
      if (!order) return Response.json({ error: "ไม่พบออเดอร์" }, { status: 404 });
      const { data: directory, error: directoryError } = await supabase.rpc("employee_directory");
      if (directoryError) throw directoryError;
      const employeeName = directory?.find((person: { id: string; name: string }) => person.id === order.created_by)?.name ?? "—";
      return Response.json({ order: { ...order, employee: { name: employeeName } } });
    }

    let query = supabase.from("orders")
      .select("id, order_no, status, subtotal_satang, discount_satang, tax_satang, total_satang, payment_method, paid_at, created_at, created_by, order_items(id, name_snapshot, emoji_snapshot, unit_price_satang, quantity, line_total_satang), payments(id, method, amount_satang, received_satang, change_satang, reference, created_at)")
      .order("created_at", { ascending: false }).limit(200);
    const search = params.get("search")?.trim();
    if (search && /^\d+$/.test(search)) query = query.eq("order_no", Number(search));
    const from = params.get("from");
    const to = params.get("to");
    if (from && !Number.isNaN(Date.parse(from))) query = query.gte("created_at", new Date(from).toISOString());
    if (to && !Number.isNaN(Date.parse(to))) query = query.lte("created_at", new Date(to).toISOString());
    const status = params.get("status");
    if (status && ["open", "preparing", "completed", "cancelled"].includes(status)) query = query.eq("status", status);
    const method = params.get("method");
    if (method === "cash" || method === "bank_transfer") query = query.eq("payment_method", method);
    const employeeId = params.get("employee");
    if (employeeId && validUuid(employeeId)) query = query.eq("created_by", employeeId);

    const { data, error } = await query;
    if (error) throw error;
    const { data: directory, error: directoryError } = await supabase.rpc("employee_directory");
    if (directoryError) throw directoryError;
    const employeeNames = new Map<string, string>((directory ?? []).map((person: { id: string; name: string }) => [person.id, person.name]));
    return Response.json({ orders: (data ?? []).map((order) => ({
      ...order,
      employee: { name: employeeNames.get(String(order.created_by)) ?? "—" },
    })) });
  } catch (error) {
    return jsonError(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user, employee } = await getPosContext();
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "ไม่มีสิทธิ์จัดการออเดอร์" }, { status: 403 });
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("action" in body)) {
      return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    if (input.action === "cancel") {
      if (!validUuid(input.orderId) || typeof input.reason !== "string" || input.reason.trim().length < 2) {
        return Response.json({ error: "กรุณาระบุออเดอร์และเหตุผลการยกเลิก" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("cancel_open_order", {
        p_order_id: input.orderId, p_reason: input.reason.trim().slice(0, 180),
      });
      if (error) throw error;
      return Response.json({ order: data });
    }
    if (input.action === "refund") {
      if (!validUuid(input.orderId) || !validSatang(input.amountSatang) ||
        typeof input.reason !== "string" || input.reason.trim().length < 2) {
        return Response.json({ error: "กรุณาระบุออเดอร์ จำนวนเงิน และเหตุผลการคืนเงิน" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("refund_order", {
        p_order_id: input.orderId, p_amount_satang: input.amountSatang,
        p_reason: input.reason.trim().slice(0, 180),
      });
      if (error) throw error;
      return Response.json({ refund: data });
    }
    if (input.action === "edit" && validUuid(input.orderId) && Array.isArray(input.items) &&
      validSatang(input.discountSatang ?? 0, true)) {
      const items = input.items as unknown[];
      if (!items.length || items.length > 100 || !items.every((line) =>
        typeof line === "object" && line !== null && "productId" in line && validUuid(line.productId) &&
        "quantity" in line && Number.isSafeInteger(line.quantity) && (line.quantity as number) > 0 && (line.quantity as number) <= 99)) {
        return Response.json({ error: "รายการสินค้าไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("update_open_order", {
        p_order_id: input.orderId,
        p_items: items.map((line) => {
          const item = line as { productId: string; quantity: number };
          return { product_id: item.productId, quantity: item.quantity };
        }),
        p_discount_satang: input.discountSatang ?? 0,
      });
      if (error) throw error;
      return Response.json({ order: data });
    }
    return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  } catch (error) {
    const message = errorMessage(error);
    return jsonError(error, message.includes("permission") || message.includes("authorized") ? 403 : 400);
  }
}
