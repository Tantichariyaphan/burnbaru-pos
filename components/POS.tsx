"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTHB } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { PosData, PosOrder, PosProduct, PosReceipt } from "@/lib/pos-types";

type Tab = "sale" | "history" | "reports";
type Modal = "openShift" | "closeShift" | "checkout" | "movement" | "cancel" | "refund" | null;
type CartLine = { product: PosProduct; quantity: number };
type ShiftPreview = {
  opening_cash_satang: number;
  cash_sales_satang: number;
  cash_refunds_satang: number;
  cash_in_satang: number;
  cash_out_satang: number;
  expected_cash_satang: number;
  transfer_sales_satang: number;
  discount_satang: number;
  tax_satang: number;
  refunds_satang: number;
  net_sales_satang: number;
  order_count: number;
};
type ShiftClosing = ShiftPreview & {
  id: string;
  closed_at: string;
  counted_cash_satang: number;
  variance_satang: number;
  notes: string | null;
  employee?: { name: string } | { name: string }[] | null;
};
type ReportRow = { name: string; total_satang: number; quantity?: number; count?: number; refunds_satang?: number; net_satang?: number };
type ReportData = {
  range: { from: string; to: string };
  summary: {
    order_count: number;
    gross_sales_satang: number;
    refunds_satang: number;
    net_sales_satang: number;
    discounts_satang: number;
    tax_satang: number;
    receipt_count: number;
  };
  by_product: ReportRow[];
  by_category: ReportRow[];
  by_employee: ReportRow[];
  by_payment_method: ReportRow[];
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function toSatang(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("จำนวนเงินไม่ถูกต้อง");
  }
  return Math.round(amount * 100);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function employeeName(order: PosOrder) {
  if (Array.isArray(order.employee)) return order.employee[0]?.name ?? "—";
  return order.employee?.name ?? "—";
}

function Dialog({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#12281e]/50 p-4" onMouseDown={onClose}>
      <section className="my-auto w-full max-w-xl rounded-3xl bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button type="button" aria-label="ปิด" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-xl">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function LoginPanel({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      onSignedIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f7f2] p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-[#dce2d9] bg-white p-7 shadow-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#245b44] text-2xl">🌿</div>
          <div><h1 className="text-2xl font-black">BurnBau POS</h1><p className="text-sm text-stone-500">เข้าสู่ระบบพนักงาน</p></div>
        </div>
        <label className="mb-4 block text-sm font-semibold">อีเมล
          <input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-[#245b44]" />
        </label>
        <label className="mb-5 block text-sm font-semibold">รหัสผ่าน
          <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-3 outline-none focus:border-[#245b44]" />
        </label>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-[#245b44] px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}</button>
      </form>
    </main>
  );
}

export default function POS() {
  const [data, setData] = useState<PosData | null>(null);
  const [shiftPreview, setShiftPreview] = useState<ShiftPreview | null>(null);
  const [shiftClosings, setShiftClosings] = useState<ShiftClosing[]>([]);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [tab, setTab] = useState<Tab>("sale");
  const [modal, setModal] = useState<Modal>(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [draftOrderId, setDraftOrderId] = useState<string | null>(null);
  const [draftOrderNo, setDraftOrderNo] = useState<number | null>(null);
  const saveKey = useRef<string | null>(null);
  const checkoutKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer">("cash");
  const [received, setReceived] = useState("");
  const [transferReference, setTransferReference] = useState("");
  const [checkoutTotal, setCheckoutTotal] = useState(0);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [movementType, setMovementType] = useState<"in" | "out">("out");
  const [movementChannel, setMovementChannel] = useState<"cash" | "bank_transfer">("cash");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [orders, setOrders] = useState<PosOrder[]>([]);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderFrom, setOrderFrom] = useState("");
  const [orderTo, setOrderTo] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderMethod, setOrderMethod] = useState("");
  const [orderEmployee, setOrderEmployee] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<PosOrder | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportFrom, setReportFrom] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [printedReceipt, setPrintedReceipt] = useState<PosReceipt | null>(null);

  const loadData = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    setError("");
    try {
      const [pos, shiftData] = await Promise.all([
        api<PosData>("/api/pos"),
        api<{ activeShift: unknown; preview: ShiftPreview | null; closings: ShiftClosing[] }>("/api/shifts"),
      ]);
      setData(pos);
      setShiftPreview(shiftData.preview);
      setShiftClosings(shiftData.closings);
      setAuthRequired(false);
      setBlockedMessage("");
      setModal((current) => !pos.activeShift && current === null ? "openShift" : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "โหลดข้อมูลไม่สำเร็จ";
      if (message.includes("กรุณาเข้าสู่ระบบ")) setAuthRequired(true);
      else if (message.includes("โปรไฟล์พนักงาน")) setBlockedMessage(message);
      else setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (tab !== "sale") return;
    const timer = window.setInterval(() => { void loadData(); }, 15000);
    return () => window.clearInterval(timer);
  }, [loadData, tab]);

  const fetchOrders = useCallback(async () => {
    const params = new URLSearchParams();
    if (orderSearch.trim()) params.set("search", orderSearch.trim());
    if (orderFrom) params.set("from", new Date(`${orderFrom}T00:00:00`).toISOString());
    if (orderTo) params.set("to", new Date(`${orderTo}T23:59:59.999`).toISOString());
    if (orderStatus) params.set("status", orderStatus);
    if (orderMethod) params.set("method", orderMethod);
    if (orderEmployee) params.set("employee", orderEmployee);
    try {
      const result = await api<{ orders: PosOrder[] }>(`/api/orders?${params.toString()}`);
      setOrders(result.orders);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "โหลดประวัติออเดอร์ไม่สำเร็จ");
    }
  }, [orderEmployee, orderFrom, orderMethod, orderSearch, orderStatus, orderTo]);

  useEffect(() => {
    if (tab !== "history" || !data) return;
    const timer = window.setTimeout(() => { void fetchOrders(); }, 250);
    return () => window.clearTimeout(timer);
  }, [data, fetchOrders, tab]);

  const fetchReport = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        from: new Date(`${reportFrom}T00:00:00`).toISOString(),
        to: new Date(`${reportTo}T23:59:59.999`).toISOString(),
      });
      setReport(await api<ReportData>(`/api/reports?${params.toString()}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "โหลดรายงานไม่สำเร็จ");
    }
  }, [reportFrom, reportTo]);

  useEffect(() => {
    if (tab !== "reports" || !data) return;
    const timer = window.setTimeout(() => { void fetchReport(); }, 0);
    return () => window.clearTimeout(timer);
  }, [data, fetchReport, tab]);

  const products = useMemo(() => data?.categories.flatMap((category) => category.products) ?? [], [data]);
  const visibleProducts = useMemo(() => products.filter((product) => {
    const categoryMatch = activeCategory === "all" || product.category_id === activeCategory;
    return categoryMatch && product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  }), [activeCategory, products, search]);
  const subtotal = cart.reduce((total, line) => total + line.product.price_satang * line.quantity, 0);
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }

  function addProduct(product: PosProduct) {
    if (!data?.activeShift) return notify("กรุณาเปิดกะก่อนเริ่มขาย");
    if (!product.available) return notify("สินค้านี้ยังไม่เปิดขาย");
    setCart((current) => {
      const line = current.find((entry) => entry.product.id === product.id);
      return line
        ? current.map((entry) => entry.product.id === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry)
        : [...current, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => current.map((line) => line.product.id === productId
      ? { ...line, quantity: line.quantity + amount } : line).filter((line) => line.quantity > 0));
  }

  async function saveOrder() {
    if (!cart.length) throw new Error("เพิ่มสินค้าในออเดอร์ก่อนบันทึก");
    if (!saveKey.current) saveKey.current = crypto.randomUUID();
    const saved = await api<{ order: { id: string; order_no: number; total_satang: number } }>("/api/pos", {
      method: "POST",
      body: JSON.stringify({
        action: "saveOrder",
        orderId: draftOrderId ?? undefined,
        idempotencyKey: saveKey.current,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        discountSatang: 0,
      }),
    });
    setDraftOrderId(saved.order.id);
    setDraftOrderNo(saved.order.order_no);
    saveKey.current = null;
    setCheckoutTotal(saved.order.total_satang);
    return saved.order;
  }

  async function finishCheckout() {
    if (busy) return;
    setBusy(true);
    try {
      const order = checkoutKey.current && draftOrderId
        ? { id: draftOrderId, order_no: draftOrderNo ?? 0, total_satang: checkoutTotal }
        : await saveOrder();
      const receivedSatang = paymentMethod === "cash" ? toSatang(received || "0") : order.total_satang;
      if (paymentMethod === "cash" && receivedSatang < order.total_satang) throw new Error("จำนวนเงินที่รับยังไม่ครบ");
      if (!checkoutKey.current) {
        checkoutKey.current = crypto.randomUUID();
        setCheckoutPending(true);
      }
      const result = await api<{ checkout: { receipt_id: string } }>("/api/pos", {
        method: "POST",
        body: JSON.stringify({
          action: "checkout",
          orderId: order.id,
          idempotencyKey: checkoutKey.current,
          method: paymentMethod,
          receivedSatang,
          reference: transferReference.trim(),
        }),
      });
      checkoutKey.current = null;
      setCheckoutPending(false);
      setModal(null);
      setCart([]);
      setDraftOrderId(null);
      setDraftOrderNo(null);
      saveKey.current = null;
      setReceived("");
      setTransferReference("");
      await loadData();
      const detail = await api<{ order: PosOrder }>("/api/orders?orderId=" + encodeURIComponent(order.id));
      const receipt = detail.order.receipts?.[0];
      if (receipt) setPrintedReceipt(receipt);
      notify(`ชำระออเดอร์ #${order.order_no} เรียบร้อย`);
      void result;
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "ชำระเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function openCheckout() {
    if (busy) return;
    setBusy(true);
    try {
      const order = await saveOrder();
      setCheckoutTotal(order.total_satang);
      setModal("checkout");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "บันทึกออเดอร์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function postPosAction(body: Record<string, unknown>) {
    await api("/api/pos", { method: "POST", body: JSON.stringify(body) });
    await loadData();
  }

  async function submitOpenShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await postPosAction({ action: "openShift", openingCashSatang: toSatang(openingCash) });
      setOpeningCash("");
      setModal(null);
      notify("เปิดกะแล้ว");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "เปิดกะไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function submitMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await postPosAction({
        action: "movement", type: movementType, channel: movementChannel,
        amountSatang: toSatang(movementAmount), reason: movementReason.trim(),
      });
      setMovementAmount("");
      setMovementReason("");
      setModal(null);
      notify("บันทึกรายการเงินแล้ว");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "บันทึกรายการไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function submitCloseShift(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.activeShift) return;
    setBusy(true);
    try {
      await postPosAction({
        action: "closeShift", shiftId: data.activeShift.id,
        countedCashSatang: toSatang(countedCash), notes: closingNotes.trim(),
      });
      setCart([]);
      setDraftOrderId(null);
      setDraftOrderNo(null);
      saveKey.current = null;
      setCountedCash("");
      setClosingNotes("");
      setModal(null);
      notify("ปิดกะและบันทึกผลกระทบยอดแล้ว");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "ปิดกะไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function openOrder(orderId: string) {
    try {
      const result = await api<{ order: PosOrder }>(`/api/orders?orderId=${encodeURIComponent(orderId)}`);
      setSelectedOrder(result.order);
      setActionReason("");
      setRefundAmount("");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "เปิดรายละเอียดออเดอร์ไม่สำเร็จ");
    }
  }

  function reopenOrder(order: PosOrder) {
    const lines: CartLine[] = [];
    for (const item of order.order_items) {
      const product = products.find((candidate) => candidate.id === item.product_id);
      if (!product) {
        notify("มีสินค้าที่ปิดใช้งานแล้วในออเดอร์นี้ จึงไม่สามารถแก้ไขได้");
        return;
      }
      lines.push({ product, quantity: item.quantity });
    }
    setCart(lines);
    setDraftOrderId(order.id);
    setDraftOrderNo(order.order_no);
    setSelectedOrder(null);
    setModal(null);
    setTab("sale");
    notify(`กำลังแก้ไขออเดอร์ #${order.order_no}`);
  }

  async function submitOrderAction(action: "cancel" | "refund") {
    if (!selectedOrder) return;
    setBusy(true);
    try {
      const payload = action === "cancel"
        ? { action, orderId: selectedOrder.id, reason: actionReason.trim() }
        : { action, orderId: selectedOrder.id, amountSatang: toSatang(refundAmount), reason: actionReason.trim() };
      await api("/api/orders", { method: "POST", body: JSON.stringify(payload) });
      setSelectedOrder(null);
      setModal(null);
      await fetchOrders();
      notify(action === "cancel" ? "ยกเลิกออเดอร์แล้ว" : "บันทึกการคืนเงินแล้ว");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "ดำเนินการไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function markDone(orderId: string) {
    try {
      await postPosAction({ action: "done", orderId });
      notify("ทำออเดอร์เสร็จแล้ว");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  async function signOut() {
    try {
      const { error: signOutError } = await createSupabaseBrowserClient().auth.signOut();
      if (signOutError) throw signOutError;
      setData(null);
      setAuthRequired(true);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "ออกจากระบบไม่สำเร็จ");
    }
  }

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#f7f7f2] text-stone-600">กำลังเชื่อมต่อข้อมูลร้าน...</main>;
  if (authRequired) return <LoginPanel onSignedIn={() => { setLoading(true); void loadData(true); }} />;
  if (blockedMessage) {
    return <main className="grid min-h-screen place-items-center bg-[#f7f7f2] p-4"><div className="max-w-lg rounded-2xl bg-white p-6 text-center shadow"><h1 className="mb-2 text-xl font-bold">ไม่มีสิทธิ์ใช้งาน</h1><p className="text-sm text-stone-600">{blockedMessage}</p><button onClick={signOut} className="mt-5 rounded-xl bg-stone-800 px-4 py-2 font-semibold text-white">ออกจากระบบ</button></div></main>;
  }
  if (!data) return <main className="grid min-h-screen place-items-center bg-[#f7f7f2] p-4"><div className="max-w-lg rounded-2xl bg-white p-6 text-center shadow"><h1 className="text-xl font-bold">เชื่อมต่อระบบไม่ได้</h1><p role="alert" className="mt-2 text-sm text-red-700">{error || "ตรวจสอบการตั้งค่า Supabase แล้วลองอีกครั้ง"}</p><button onClick={() => void loadData(true)} className="mt-4 rounded-xl bg-[#245b44] px-4 py-2 font-bold text-white">ลองอีกครั้ง</button></div></main>;

  const activeQueue = data.queue;
  const isManager = data.employee.role === "owner" || data.employee.role === "manager";

  return (
    <main className="min-h-screen bg-[#f7f8f5] p-3 text-stone-800 max-sm:p-2 lg:h-screen lg:overflow-hidden">
      <header className="mb-3 flex min-h-[72px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dce2d9] bg-white px-4 py-3 shadow-[0_6px_20px_rgba(31,58,43,.06)]">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#245b44] text-2xl">🌿</div>
          <div><h1 className="text-lg font-extrabold tracking-tight">BurnBau</h1><p className="text-xs text-stone-500">{data.employee.name} · {data.activeShift ? "กะเปิดอยู่" : "ยังไม่ได้เปิดกะ"}</p></div>
        </div>
        <nav className="flex items-center gap-1" aria-label="เมนูหลัก">
          {([["sale", "ขาย"], ["history", "ประวัติออเดอร์"], ["reports", "รายงาน"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === id ? "bg-[#e8f2eb] text-[#245b44]" : "text-stone-500 hover:bg-stone-100"}`}>{label}</button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadData()} className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-600">รีเฟรช</button>
          <button disabled={!data.activeShift} onClick={() => setModal("movement")} className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-600 disabled:opacity-40">เงินเข้า-ออก</button>
          <button onClick={() => setModal(data.activeShift ? "closeShift" : "openShift")} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${data.activeShift ? "bg-stone-800" : "bg-[#245b44]"}`}>{data.activeShift ? "ปิดกะ" : "เปิดกะ"}</button>
          <button aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={signOut} className="rounded-xl px-2 py-2 text-sm text-stone-500 hover:bg-stone-100">ออก</button>
        </div>
      </header>

      {error && <div role="alert" className="mb-3 flex items-center justify-between rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700"><span>{error}</span><button onClick={() => setError("")} aria-label="dismiss">×</button></div>}
      {toast && <div role="status" className="fixed left-1/2 top-24 z-[60] -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-xl">{toast}</div>}

      {tab === "sale" && (
        <section className="grid min-h-0 gap-3 lg:h-[calc(100vh-108px)] lg:grid-cols-[1.13fr_1fr_.95fr]">
          <section className="flex min-h-[420px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm lg:min-h-0">
            <div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Menu</p><h2 className="text-xl font-extrabold">เลือกเมนู</h2></div><span className="text-xs text-stone-400">{visibleProducts.length} รายการ</span></div>
            <label className="mb-3 flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-stone-400"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent text-sm text-stone-800 outline-none" placeholder="ค้นหาสินค้า..." /></label>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => setActiveCategory("all")} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold ${activeCategory === "all" ? "bg-[#245b44] text-white" : "bg-stone-100 text-stone-600"}`}>ทั้งหมด</button>
              {data.categories.map((category) => <button key={category.id} onClick={() => setActiveCategory(category.id)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold ${activeCategory === category.id ? "bg-[#245b44] text-white" : "bg-stone-100 text-stone-600"}`}>{category.emoji} {category.name}</button>)}
            </div>
            <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {visibleProducts.map((product) => <button key={product.id} disabled={!product.available || !data.activeShift || busy || checkoutPending} onClick={() => addProduct(product)} className={`min-h-32 rounded-xl border p-3 text-left transition ${product.available && data.activeShift ? "border-stone-200 hover:border-[#5b826c] hover:bg-[#f4faf5]" : "border-stone-100 bg-stone-50 opacity-60"}`}><div className="mb-3 text-2xl">{product.emoji ?? "🍽️"}</div><p className="min-h-10 text-sm font-bold leading-5">{product.name}</p><div className="mt-2 flex items-center justify-between"><span className={`text-sm font-extrabold ${product.available ? "text-[#245b44]" : "text-amber-700"}`}>{product.available ? formatTHB(product.price_satang) : "ยังไม่เปิดขาย"}</span><span className="grid h-6 w-6 place-items-center rounded-full bg-white text-lg text-stone-400">+</span></div></button>)}
            </div>
          </section>

          <section className="flex min-h-[440px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm lg:min-h-0">
            <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Current order</p><h2 className="text-xl font-extrabold">{draftOrderId ? "ออเดอร์ที่บันทึกแล้ว" : "ออเดอร์ใหม่"}</h2></div><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold">{itemCount} ชิ้น</span></div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {cart.map(({ product, quantity }) => <article key={product.id} className="flex items-center gap-3 rounded-xl border border-stone-100 p-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f1f5ef] text-xl">{product.emoji ?? "🍽️"}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{product.name}</p><p className="text-xs text-stone-500">{formatTHB(product.price_satang)} / ชิ้น</p></div><div className="flex items-center gap-2"><button disabled={checkoutPending || busy} onClick={() => changeQuantity(product.id, -1)} className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 font-bold disabled:opacity-40">−</button><span className="w-5 text-center text-sm font-bold">{quantity}</span><button disabled={checkoutPending || busy} onClick={() => changeQuantity(product.id, 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 font-bold disabled:opacity-40">+</button></div><strong className="w-20 text-right text-sm">{formatTHB(product.price_satang * quantity)}</strong></article>)}
              {!cart.length && <div className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-400">เลือกสินค้าเพื่อเริ่มออเดอร์</div>}
            </div>
            <div className="mt-4 border-t border-stone-100 pt-4">
              <div className="flex justify-between text-sm text-stone-500"><span>ยอดก่อนภาษี</span><span>{formatTHB(subtotal)}</span></div>
              <div className="mt-2 flex justify-between text-lg font-extrabold"><span>รวม</span><span className="text-[#245b44]">{formatTHB(subtotal)}</span></div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button disabled={!cart.length || busy || checkoutPending} onClick={async () => {
                  setBusy(true);
                  try { const order = await saveOrder(); notify(`บันทึกออเดอร์ #${order.order_no} แล้ว`); }
                  catch (reason) { notify(reason instanceof Error ? reason.message : "บันทึกไม่สำเร็จ"); }
                  finally { setBusy(false); }
                }} className="rounded-xl border border-[#245b44] px-3 py-3 text-sm font-bold text-[#245b44] disabled:opacity-40">{busy ? "กำลังบันทึก..." : "บันทึกยังไม่ชำระ"}</button>
                <button disabled={!cart.length || !data.activeShift || busy} onClick={() => checkoutPending ? setModal("checkout") : void openCheckout()} className="rounded-xl bg-[#245b44] px-3 py-3 text-sm font-bold text-white disabled:opacity-40">{checkoutPending ? "ดำเนินการชำระต่อ" : busy ? "กำลังบันทึก..." : "ชำระเงิน"}</button>
              </div>
            </div>
          </section>

          <section className="flex min-h-[420px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm lg:min-h-0">
            <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Preparation</p><h2 className="text-xl font-extrabold">กำลังเตรียม</h2></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{activeQueue.length}</span></div>
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {activeQueue.map((order) => <article key={order.id} className="rounded-xl border border-stone-100 p-3"><div className="mb-2 flex items-center justify-between"><strong>#{order.order_no}</strong><span className="text-xs text-stone-400">{formatDate(order.paid_at)}</span></div><div className="space-y-1">{order.order_items.map((line) => <p key={line.id} className="text-sm text-stone-600">{line.name_snapshot} × {line.quantity}</p>)}</div><div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2"><strong className="text-sm">{formatTHB(order.total_satang)}</strong><button onClick={() => void markDone(order.id)} className="rounded-lg bg-[#245b44] px-3 py-2 text-xs font-bold text-white">เสร็จแล้ว</button></div></article>)}
              {!activeQueue.length && <div className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-400">ยังไม่มีออเดอร์ที่ต้องเตรียม</div>}
            </div>
          </section>
        </section>
      )}

      {tab === "history" && (
        <section className="h-[calc(100vh-108px)] overflow-hidden rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Transactions</p><h2 className="text-xl font-extrabold">ประวัติออเดอร์</h2></div><button onClick={() => void fetchOrders()} className="rounded-xl border px-3 py-2 text-sm font-semibold">รีเฟรช</button></div>
          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <input aria-label="ค้นหาเลขออเดอร์" placeholder="ค้นหาเลขออเดอร์" value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
            <input aria-label="วันที่เริ่มต้น" type="date" value={orderFrom} onChange={(event) => setOrderFrom(event.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
            <input aria-label="วันที่สิ้นสุด" type="date" value={orderTo} onChange={(event) => setOrderTo(event.target.value)} className="rounded-xl border px-3 py-2 text-sm" />
            <select aria-label="สถานะออเดอร์" value={orderStatus} onChange={(event) => setOrderStatus(event.target.value)} className="rounded-xl border px-3 py-2 text-sm"><option value="">ทุกสถานะชำระ</option><option value="open">ยังไม่ชำระ</option><option value="preparing">กำลังเตรียม</option><option value="completed">เสร็จแล้ว</option><option value="cancelled">ยกเลิก</option></select>
            <select aria-label="ช่องทางชำระ" value={orderMethod} onChange={(event) => setOrderMethod(event.target.value)} className="rounded-xl border px-3 py-2 text-sm"><option value="">ทุกช่องทาง</option><option value="cash">เงินสด</option><option value="bank_transfer">โอนเงิน</option></select>
            {isManager && <select aria-label="พนักงาน" value={orderEmployee} onChange={(event) => setOrderEmployee(event.target.value)} className="rounded-xl border px-3 py-2 text-sm"><option value="">พนักงานทุกคน</option>{data.employees?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>}
          </div>
          <div className="h-[calc(100%-120px)] overflow-auto">
            <table className="w-full min-w-[850px] text-left text-sm"><thead className="sticky top-0 bg-stone-50 text-xs uppercase text-stone-500"><tr><th className="p-3">ออเดอร์ / เวลา</th><th className="p-3">พนักงาน</th><th className="p-3">รายการ</th><th className="p-3">ก่อนลด / ลด / ภาษี</th><th className="p-3">ยอดรวม</th><th className="p-3">ชำระ</th><th className="p-3">สถานะ</th></tr></thead><tbody>
              {orders.map((order) => <tr key={order.id} onClick={() => void openOrder(order.id)} className="cursor-pointer border-t border-stone-100 hover:bg-[#f8faf7]"><td className="p-3 font-bold">#{order.order_no}<p className="mt-1 text-xs font-normal text-stone-500">{formatDate(order.created_at)}</p></td><td className="p-3">{employeeName(order)}</td><td className="p-3">{order.order_items.reduce((total, line) => total + line.quantity, 0)} ชิ้น · {order.order_items.map((line) => line.name_snapshot).slice(0, 2).join(", ")}</td><td className="p-3 text-xs">{formatTHB(order.subtotal_satang)} / {formatTHB(order.discount_satang)} / {formatTHB(order.tax_satang)}</td><td className="p-3 font-bold">{formatTHB(order.total_satang)}</td><td className="p-3">{order.payment_method === "cash" ? "เงินสด" : order.payment_method === "bank_transfer" ? "โอนเงิน" : "—"}</td><td className="p-3">{order.status === "open" ? "ยังไม่ชำระ" : order.status === "preparing" ? "กำลังเตรียม" : order.status === "completed" ? "เสร็จแล้ว" : "ยกเลิก"}</td></tr>)}
              {!orders.length && <tr><td colSpan={7} className="p-8 text-center text-stone-400">ไม่พบออเดอร์ตามตัวกรอง</td></tr>}
            </tbody></table>
          </div>
        </section>
      )}

      {tab === "reports" && (
        <section className="h-[calc(100vh-108px)] overflow-y-auto rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Database reports</p><h2 className="text-xl font-extrabold">รายงานจากรายการจริง</h2></div><div className="flex flex-wrap items-center gap-2"><input aria-label="เริ่มรายงานวันที่" type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} className="rounded-xl border px-3 py-2 text-sm" /><input aria-label="สิ้นสุดรายงานวันที่" type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} className="rounded-xl border px-3 py-2 text-sm" /><button onClick={() => void fetchReport()} className="rounded-xl bg-[#245b44] px-3 py-2 text-sm font-bold text-white">แสดงรายงาน</button></div></div>
          {report ? <>
            <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric title="ยอดขายก่อนคืนเงิน" value={report.summary.gross_sales_satang} />
              <Metric title="คืนเงิน" value={report.summary.refunds_satang} />
              <Metric title="ยอดขายสุทธิ (รวมภาษี)" value={report.summary.net_sales_satang} />
              <div className="rounded-2xl bg-[#f4f7f2] p-4"><p className="text-xs text-stone-500">จำนวนออเดอร์ที่ชำระแล้ว</p><p className="mt-2 text-xl font-extrabold">{report.summary.order_count}</p></div>
              <Metric title="ส่วนลด" value={report.summary.discounts_satang} />
              <Metric title="ภาษี" value={report.summary.tax_satang} />
              <div className="rounded-2xl bg-[#f4f7f2] p-4"><p className="text-xs text-stone-500">ใบเสร็จ</p><p className="mt-2 text-xl font-extrabold">{report.summary.receipt_count}</p></div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ReportTable title="ยอดขายตามสินค้า" rows={report.by_product} />
              <ReportTable title="ยอดขายตามหมวดหมู่" rows={report.by_category} />
              <ReportTable title="ยอดขายตามพนักงาน" rows={report.by_employee} />
              <ReportTable title="ยอดขายตามช่องทาง" rows={report.by_payment_method} showNet />
            </div>
          </> : <p className="py-12 text-center text-stone-400">กำลังโหลดรายงาน...</p>}
          <div className="mt-6">
            <h3 className="mb-2 text-lg font-bold">ประวัติปิดกะ</h3>
            <div className="overflow-auto rounded-xl border"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="p-3">เวลาปิด</th><th className="p-3">พนักงาน</th><th className="p-3">เงินสดคาดหมาย</th><th className="p-3">นับจริง</th><th className="p-3">ส่วนต่าง</th><th className="p-3">ยอดสุทธิ</th></tr></thead><tbody>{shiftClosings.map((closing) => <tr key={closing.id} className="border-t"><td className="p-3">{formatDate(closing.closed_at)}</td><td className="p-3">{Array.isArray(closing.employee) ? closing.employee[0]?.name : closing.employee?.name ?? "—"}</td><td className="p-3">{formatTHB(closing.expected_cash_satang)}</td><td className="p-3">{formatTHB(closing.counted_cash_satang)}</td><td className="p-3">{formatTHB(closing.variance_satang)}</td><td className="p-3">{formatTHB(closing.net_sales_satang)}</td></tr>)}{!shiftClosings.length && <tr><td colSpan={6} className="p-5 text-center text-stone-400">ยังไม่มีประวัติปิดกะ</td></tr>}</tbody></table></div>
          </div>
        </section>
      )}

      {modal === "openShift" && <Dialog title="เปิดกะขาย" onClose={() => setModal(null)}><form onSubmit={(event) => void submitOpenShift(event)}><p className="mb-4 text-sm text-stone-600">ระบุเงินสดเริ่มต้นในลิ้นชัก ระบบจะบันทึกพนักงานและเวลาเปิดกะ</p><label className="block text-sm font-semibold">เงินสดเริ่มต้น (บาท)<input required min="0" step="0.01" type="number" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><button disabled={busy} className="mt-5 w-full rounded-xl bg-[#245b44] px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังเปิดกะ..." : "ยืนยันเปิดกะ"}</button></form></Dialog>}

      {modal === "closeShift" && <Dialog title="ปิดกะและกระทบยอด" onClose={() => setModal(null)}><form onSubmit={(event) => void submitCloseShift(event)}><div className="mb-4 grid grid-cols-2 gap-2 text-sm">{[
        ["เงินสดเปิดกะ", shiftPreview?.opening_cash_satang], ["ขายเงินสด", shiftPreview?.cash_sales_satang],
        ["คืนเงินสด", shiftPreview?.cash_refunds_satang], ["เงินสดเข้า", shiftPreview?.cash_in_satang],
        ["เงินสดออก", shiftPreview?.cash_out_satang], ["เงินสดคาดหมาย", shiftPreview?.expected_cash_satang],
        ["ยอดโอน", shiftPreview?.transfer_sales_satang], ["ส่วนลด", shiftPreview?.discount_satang],
        ["ภาษี", shiftPreview?.tax_satang], ["คืนเงินรวม", shiftPreview?.refunds_satang],
        ["ยอดสุทธิ", shiftPreview?.net_sales_satang], ["จำนวนออเดอร์", shiftPreview?.order_count],
      ].map(([label, value]) => <div key={label} className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-stone-500">{label}</p><p className="mt-1 font-bold">{value === undefined ? "—" : label === "จำนวนออเดอร์" ? value : formatTHB(value as number)}</p></div>)}</div><label className="block text-sm font-semibold">เงินสดที่นับได้จริง (บาท)<input required min="0" step="0.01" type="number" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><label className="mt-3 block text-sm font-semibold">หมายเหตุ (ไม่บังคับ)<textarea value={closingNotes} onChange={(event) => setClosingNotes(event.target.value)} maxLength={500} className="mt-1 w-full rounded-xl border px-3 py-2" /></label><button disabled={busy} className="mt-5 w-full rounded-xl bg-stone-800 px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังปิดกะ..." : "บันทึกและปิดกะ"}</button></form></Dialog>}

      {modal === "movement" && <Dialog title="บันทึกเงินเข้า-ออก" onClose={() => setModal(null)}><form onSubmit={(event) => void submitMovement(event)}><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">ประเภทรายการ<select value={movementType} onChange={(event) => setMovementType(event.target.value as "in" | "out")} className="mt-1 w-full rounded-xl border px-3 py-3"><option value="in">เงินเข้า</option><option value="out">เงินออก</option></select></label><label className="text-sm font-semibold">ช่องทาง<select value={movementChannel} onChange={(event) => setMovementChannel(event.target.value as "cash" | "bank_transfer")} className="mt-1 w-full rounded-xl border px-3 py-3"><option value="cash">เงินสด</option><option value="bank_transfer">โอนเงิน</option></select></label></div><label className="mt-3 block text-sm font-semibold">จำนวนเงิน (บาท)<input required min="0.01" step="0.01" type="number" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><label className="mt-3 block text-sm font-semibold">เหตุผล / หมวดหมู่<input required minLength={2} maxLength={180} value={movementReason} onChange={(event) => setMovementReason(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><button disabled={busy} className="mt-5 w-full rounded-xl bg-[#245b44] px-4 py-3 font-bold text-white disabled:opacity-50">บันทึกรายการ</button></form></Dialog>}

      {modal === "checkout" && <Dialog title="ชำระเงิน" onClose={() => !busy && setModal(null)}><div className="mb-4 flex items-center justify-between rounded-xl bg-[#f4f7f2] p-4"><span className="font-semibold">ยอดชำระ</span><strong className="text-2xl text-[#245b44]">{formatTHB(checkoutTotal)}</strong></div><div className="mb-4 grid grid-cols-2 gap-2"><button onClick={() => setPaymentMethod("cash")} className={`rounded-xl border p-3 font-bold ${paymentMethod === "cash" ? "border-[#245b44] bg-[#e8f2eb] text-[#245b44]" : "border-stone-200"}`}>เงินสด</button><button onClick={() => setPaymentMethod("bank_transfer")} className={`rounded-xl border p-3 font-bold ${paymentMethod === "bank_transfer" ? "border-[#245b44] bg-[#e8f2eb] text-[#245b44]" : "border-stone-200"}`}>โอนเงิน</button></div>{paymentMethod === "cash" ? <label className="block text-sm font-semibold">รับเงิน (บาท)<input required min={checkoutTotal / 100} step="0.01" type="number" value={received} onChange={(event) => setReceived(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /><p className="mt-2 text-sm text-stone-500">เงินทอน {formatTHB(Math.max(0, (Number(received || "0") * 100) - checkoutTotal))}</p></label> : <label className="block text-sm font-semibold">เลขอ้างอิง (ไม่บังคับ)<input value={transferReference} maxLength={120} onChange={(event) => setTransferReference(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>}<button disabled={busy} onClick={() => void finishCheckout()} className="mt-5 w-full rounded-xl bg-[#245b44] px-4 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังบันทึกการชำระ..." : "ยืนยันการชำระเงิน"}</button></Dialog>}

      {modal === "cancel" && selectedOrder && <Dialog title={`ยกเลิกออเดอร์ #${selectedOrder.order_no}`} onClose={() => setModal(null)}><p className="mb-3 text-sm text-stone-600">ยกเลิกได้เฉพาะออเดอร์ที่ยังไม่ชำระ รายการจะถูกเก็บไว้ในประวัติ</p><label className="block text-sm font-semibold">เหตุผล<input required minLength={2} maxLength={180} value={actionReason} onChange={(event) => setActionReason(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><button disabled={busy} onClick={() => void submitOrderAction("cancel")} className="mt-4 w-full rounded-xl bg-red-700 px-4 py-3 font-bold text-white">ยืนยันยกเลิกออเดอร์</button></Dialog>}

      {modal === "refund" && selectedOrder && <Dialog title={`คืนเงินออเดอร์ #${selectedOrder.order_no}`} onClose={() => setModal(null)}><p className="mb-3 text-sm text-stone-600">คืนเงินได้ไม่เกินยอดชำระคงเหลือ และต้องระบุเหตุผล</p><label className="block text-sm font-semibold">จำนวนเงิน (บาท)<input required min="0.01" step="0.01" type="number" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><label className="mt-3 block text-sm font-semibold">เหตุผล<input required minLength={2} maxLength={180} value={actionReason} onChange={(event) => setActionReason(event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" /></label><button disabled={busy} onClick={() => void submitOrderAction("refund")} className="mt-4 w-full rounded-xl bg-red-700 px-4 py-3 font-bold text-white">บันทึกการคืนเงิน</button></Dialog>}

      {selectedOrder && modal !== "cancel" && modal !== "refund" && <Dialog title={`ออเดอร์ #${selectedOrder.order_no}`} onClose={() => setSelectedOrder(null)}><div className="max-h-[70vh] overflow-y-auto pr-1"><div className="mb-3 grid grid-cols-2 gap-2 text-sm"><div><span className="text-stone-500">วันที่:</span> {formatDate(selectedOrder.created_at)}</div><div><span className="text-stone-500">พนักงาน:</span> {employeeName(selectedOrder)}</div><div><span className="text-stone-500">สถานะ:</span> {selectedOrder.status}</div><div><span className="text-stone-500">ช่องทาง:</span> {selectedOrder.payment_method ?? "—"}</div></div><div className="divide-y rounded-xl border">{selectedOrder.order_items.map((line) => <div key={line.id} className="flex justify-between gap-3 p-3 text-sm"><span>{line.name_snapshot} × {line.quantity}</span><strong>{formatTHB(line.line_total_satang)}</strong></div>)}</div><div className="mt-3 space-y-1 text-sm"><TotalLine label="ยอดสินค้า" value={selectedOrder.subtotal_satang} /><TotalLine label="ส่วนลด" value={-selectedOrder.discount_satang} /><TotalLine label="ภาษี" value={selectedOrder.tax_satang} /><TotalLine label="ยอดรวม" value={selectedOrder.total_satang} bold /></div><h3 className="mb-2 mt-5 font-bold">ประวัติชำระเงิน</h3>{selectedOrder.payments?.length ? selectedOrder.payments.map((payment) => <p key={payment.id} className="text-sm text-stone-600">{formatDate(payment.created_at)} · {payment.method} · {formatTHB(payment.amount_satang)}{payment.reference ? ` · ${payment.reference}` : ""}</p>) : <p className="text-sm text-stone-400">ยังไม่มีการชำระเงิน</p>}<h3 className="mb-2 mt-4 font-bold">ประวัติคืนเงิน</h3>{selectedOrder.refunds?.length ? selectedOrder.refunds.map((refund) => <p key={refund.id} className="text-sm text-stone-600">{formatDate(refund.created_at)} · {refund.channel} · {formatTHB(refund.amount_satang)} · {refund.reason}</p>) : <p className="text-sm text-stone-400">ไม่มีรายการคืนเงิน</p>}{selectedOrder.receipts?.[0] && <button onClick={() => { setPrintedReceipt(selectedOrder.receipts?.[0] ?? null); window.setTimeout(() => window.print(), 50); }} className="mt-4 w-full rounded-xl border border-[#245b44] px-4 py-2.5 font-bold text-[#245b44]">ดู / พิมพ์ใบเสร็จ #{selectedOrder.receipts[0].receipt_no}</button>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{selectedOrder.status === "open" && <><button onClick={() => reopenOrder(selectedOrder)} className="rounded-xl bg-[#245b44] px-3 py-2.5 text-sm font-bold text-white">แก้ไขออเดอร์ที่ยังไม่ชำระ</button><button onClick={() => { setModal("cancel"); setActionReason(""); }} className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">ยกเลิกออเดอร์</button></>}{isManager && ["preparing", "completed"].includes(selectedOrder.status) && <button onClick={() => { setModal("refund"); const refunded = selectedOrder.refunds?.reduce((total, item) => total + item.amount_satang, 0) ?? 0; setRefundAmount((Math.max(0, selectedOrder.total_satang - refunded) / 100).toFixed(2)); setActionReason(""); }} className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">คืนเงิน</button>}</div></div></Dialog>}

      {printedReceipt && <div className="fixed inset-0 z-[70] overflow-auto bg-white p-6">
        <div id="receipt" className="mx-auto max-w-sm text-stone-900">
          <div className="text-center"><h2 className="text-2xl font-black">BurnBau</h2><p className="text-sm">ใบเสร็จรับเงิน</p><p className="mt-3 text-sm">#{printedReceipt.receipt_no} · ออเดอร์ #{printedReceipt.snapshot.order_no}</p><p className="text-xs">{formatDate(printedReceipt.snapshot.paid_at)}</p><p className="text-xs">พนักงาน: {printedReceipt.snapshot.employee_name}</p></div>
          <div className="my-4 border-y border-dashed py-3">{printedReceipt.snapshot.items.map((item, index) => <div key={`${item.name}-${index}`} className="mb-2 flex justify-between gap-2 text-sm"><span>{item.name} × {item.quantity}</span><span>{formatTHB(item.line_total_satang)}</span></div>)}</div>
          <TotalLine label="ยอดสินค้า" value={printedReceipt.snapshot.subtotal_satang} /><TotalLine label="ส่วนลด" value={-printedReceipt.snapshot.discount_satang} /><TotalLine label="ภาษี" value={printedReceipt.snapshot.tax_satang} /><TotalLine label="ชำระแล้ว" value={printedReceipt.snapshot.total_satang} bold />
          <p className="mt-3 text-center text-xs">ชำระด้วย {printedReceipt.snapshot.payment_method === "cash" ? "เงินสด" : "โอนเงิน"}{printedReceipt.snapshot.reference ? ` · ${printedReceipt.snapshot.reference}` : ""}</p>
        </div>
        <div className="mx-auto mt-5 flex max-w-sm gap-2 print:hidden"><button onClick={() => window.print()} className="flex-1 rounded-xl bg-[#245b44] px-4 py-3 font-bold text-white">พิมพ์ใบเสร็จ</button><button onClick={() => setPrintedReceipt(null)} className="rounded-xl border px-4 py-3 font-bold">ปิด</button></div>
      </div>}
    </main>
  );
}

function Metric({ title, value }: { title: string; value: number }) {
  return <div className="rounded-2xl bg-[#f4f7f2] p-4"><p className="text-xs text-stone-500">{title}</p><p className="mt-2 text-xl font-extrabold">{formatTHB(value)}</p></div>;
}

function ReportTable({ title, rows, showNet = false }: { title: string; rows: ReportRow[]; showNet?: boolean }) {
  return <section className="overflow-hidden rounded-xl border"><h3 className="bg-stone-50 px-3 py-2.5 font-bold">{title}</h3><table className="w-full text-sm"><tbody>{rows.map((row) => <tr key={row.name} className="border-t"><td className="p-3">{row.name}{row.quantity ? <span className="ml-2 text-xs text-stone-400">{row.quantity} ชิ้น</span> : null}</td><td className="p-3 text-right font-semibold">{showNet ? formatTHB(row.net_satang ?? 0) : formatTHB(row.total_satang)}</td></tr>)}{!rows.length && <tr><td className="p-4 text-center text-stone-400">ไม่มีรายการในช่วงนี้</td></tr>}</tbody></table></section>;
}

function TotalLine({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "text-base font-extrabold" : "text-sm text-stone-600"}`}><span>{label}</span><span>{formatTHB(value)}</span></div>;
}
