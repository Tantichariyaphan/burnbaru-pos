import { apiFailure, logRpcFailure } from "@/lib/api-errors";
import { getPosContext, isEmployee, validSatang, validUuid } from "@/lib/pos-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, user, employee } = await getPosContext("api/pos GET");
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "บัญชีนี้ยังไม่มีโปรไฟล์พนักงานที่เปิดใช้งาน" }, { status: 403 });

    const [categoriesResult, productsResult, shiftResult, queueResult] = await Promise.all([
      supabase.from("categories").select("id, name, emoji, sort_order").eq("active", true).order("sort_order"),
      supabase.from("products").select("id, name, emoji, category_id, price_satang, available, sort_order").eq("active", true).order("sort_order"),
      supabase.from("shifts").select("id, opening_cash_satang, opened_at, opened_by").eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("orders").select("id, order_no, total_satang, status, paid_at, created_at, payment_method, order_items(id, name_snapshot, emoji_snapshot, unit_price_satang, quantity, line_total_satang)")
        .eq("status", "preparing").order("paid_at", { ascending: true }).limit(60),
    ]);

    const failure = [categoriesResult.error, productsResult.error, shiftResult.error, queueResult.error].find(Boolean);
    if (failure) throw failure;
    const employeesResult = await supabase.rpc("employee_directory");
    if (employeesResult.error) {
      logRpcFailure("api/pos GET", "employee_directory", employeesResult.error);
      throw employeesResult.error;
    }
    const categories = (categoriesResult.data ?? []).map((category) => ({
      ...category,
      products: (productsResult.data ?? []).filter((product) => product.category_id === category.id),
    }));

    return Response.json({
      employee,
      categories,
      activeShift: shiftResult.data,
      queue: queueResult.data ?? [],
      employees: employeesResult.data ?? [],
    });
  } catch (error) {
    return apiFailure(error, "api/pos GET");
  }
}

type OrderLineInput = { productId: string; quantity: number };

function validItems(value: unknown): value is OrderLineInput[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 &&
    value.every((line) => typeof line === "object" && line !== null &&
      "productId" in line && validUuid(line.productId) &&
      "quantity" in line && Number.isSafeInteger(line.quantity) &&
      (line.quantity as number) >= 1 && (line.quantity as number) <= 99);
}

export async function POST(request: Request) {
  try {
    const { supabase, user, employee } = await getPosContext("api/pos POST");
    if (!user) return Response.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
    if (!isEmployee(user, employee)) return Response.json({ error: "ไม่มีสิทธิ์ใช้งานระบบขาย" }, { status: 403 });

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("action" in body)) {
      return Response.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
    }
    const input = body as Record<string, unknown>;

    if (input.action === "openShift") {
      if (!validSatang(input.openingCashSatang, true)) return Response.json({ error: "ยอดเงินเปิดกะไม่ถูกต้อง" }, { status: 400 });
      const { data, error } = await supabase.rpc("open_shift", {
        p_opening_cash_satang: input.openingCashSatang,
        p_register_id: typeof input.registerId === "string" ? input.registerId.slice(0, 40) : "POS1",
      });
      if (error) {
        logRpcFailure("api/pos POST", "open_shift", error);
        throw error;
      }
      return Response.json({ shift: data });
    }

    if (input.action === "saveOrder") {
      if (!validItems(input.items) || !validSatang(input.discountSatang ?? 0, true)) {
        return Response.json({ error: "รายการสินค้าไม่ถูกต้อง" }, { status: 400 });
      }
      if (input.orderId !== undefined && !validUuid(input.orderId)) return Response.json({ error: "รหัสออเดอร์ไม่ถูกต้อง" }, { status: 400 });
      const rpcName = input.orderId ? "update_open_order" : "create_order";
      const rpcArgs = input.orderId
        ? {
          p_order_id: input.orderId,
          p_items: input.items.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
          p_discount_satang: input.discountSatang ?? 0,
        }
        : {
          p_items: input.items.map((line) => ({ product_id: line.productId, quantity: line.quantity })),
          p_discount_satang: input.discountSatang ?? 0,
          p_idempotency_key: validUuid(input.idempotencyKey) ? input.idempotencyKey : crypto.randomUUID(),
        };
      const { data, error } = await supabase.rpc(rpcName, rpcArgs);
      if (error) {
        logRpcFailure("api/pos POST", rpcName, error);
        throw error;
      }
      return Response.json({ order: data });
    }

    if (input.action === "checkout") {
      if (!validUuid(input.orderId) || !validUuid(input.idempotencyKey) ||
        (input.method !== "cash" && input.method !== "bank_transfer") ||
        !validSatang(input.receivedSatang, true)) {
        return Response.json({ error: "ข้อมูลการชำระเงินไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("checkout_order", {
        p_order_id: input.orderId,
        p_method: input.method,
        p_received_satang: input.receivedSatang,
        p_reference: typeof input.reference === "string" ? input.reference.slice(0, 120) : null,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) {
        logRpcFailure("api/pos POST", "checkout_order", error);
        throw error;
      }
      return Response.json({ checkout: data });
    }

    if (input.action === "done") {
      if (!validUuid(input.orderId)) return Response.json({ error: "รหัสออเดอร์ไม่ถูกต้อง" }, { status: 400 });
      const { data, error } = await supabase.rpc("mark_order_done", { p_order_id: input.orderId });
      if (error) {
        logRpcFailure("api/pos POST", "mark_order_done", error);
        throw error;
      }
      return Response.json({ order: data });
    }

    if (input.action === "movement") {
      if ((input.type !== "in" && input.type !== "out") ||
        (input.channel !== "cash" && input.channel !== "bank_transfer") ||
        !validSatang(input.amountSatang) || typeof input.reason !== "string" ||
        input.reason.trim().length < 2 || input.reason.length > 180) {
        return Response.json({ error: "กรอกประเภทรายการ ช่องทาง จำนวนเงิน และเหตุผลให้ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("record_cash_movement", {
        p_type: input.type,
        p_channel: input.channel,
        p_amount_satang: input.amountSatang,
        p_reason: input.reason.trim(),
        p_note: typeof input.note === "string" ? input.note.slice(0, 500) : null,
      });
      if (error) {
        logRpcFailure("api/pos POST", "record_cash_movement", error);
        throw error;
      }
      return Response.json({ movement: data });
    }

    if (input.action === "closeShift") {
      if (!validUuid(input.shiftId) || !validSatang(input.countedCashSatang, true)) {
        return Response.json({ error: "ข้อมูลปิดกะไม่ถูกต้อง" }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("close_shift", {
        p_shift_id: input.shiftId,
        p_counted_cash_satang: input.countedCashSatang,
        p_notes: typeof input.notes === "string" ? input.notes.slice(0, 500) : null,
      });
      if (error) {
        logRpcFailure("api/pos POST", "close_shift", error);
        throw error;
      }
      return Response.json({ closing: data });
    }

    return Response.json({ error: "ไม่รู้จักคำสั่งนี้" }, { status: 400 });
  } catch (error) {
    return apiFailure(error, "api/pos POST");
  }
}
