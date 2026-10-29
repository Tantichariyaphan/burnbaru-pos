"use client";

import { useMemo, useState } from "react";
import { formatTHB } from "@/lib/money";

type PaymentMethod = "cash" | "bank_transfer";
type PreparationStatus = "preparing" | "completed";
type Modal = "openShift" | "closeShift" | "checkout" | "cashMovement" | "report" | null;
type Product = { id: string; name: string; category: string; emoji: string; priceSatang: number; available: boolean };
type CartLine = { product: Product; quantity: number };
type Sale = { id: number; lines: CartLine[]; totalSatang: number; method: PaymentMethod; reference?: string; status: PreparationStatus; time: string };
type CashMovement = { type: "in" | "out"; channel: PaymentMethod; amountSatang: number; reason: string };

const products: Product[] = [
  { id: "original", name: "Original Cheesecake", category: "ชีสเค้ก", emoji: "🍰", priceSatang: 5900, available: true },
  { id: "matcha-cake", name: "Matcha Cheesecake", category: "ชีสเค้ก", emoji: "🍵", priceSatang: 7900, available: true },
  { id: "red-velvet", name: "Red Velvet Cheesecake", category: "ชีสเค้ก", emoji: "❤️", priceSatang: 6900, available: true },
  { id: "matcha", name: "Matcha", category: "มัทฉะและชา", emoji: "🍵", priceSatang: 0, available: false },
  { id: "clear-matcha", name: "Clear Matcha", category: "มัทฉะและชา", emoji: "🧊", priceSatang: 0, available: false },
  { id: "matcha-latte", name: "Matcha Latte", category: "มัทฉะและชา", emoji: "🥛", priceSatang: 0, available: false },
  { id: "hojicha", name: "Hojicha Latte", category: "มัทฉะและชา", emoji: "☕", priceSatang: 0, available: false },
  { id: "apple-tea", name: "Apple Tea", category: "มัทฉะและชา", emoji: "🍎", priceSatang: 0, available: false },
  { id: "peach-tea", name: "Peach Tea", category: "มัทฉะและชา", emoji: "🍑", priceSatang: 0, available: false },
];
const categories = ["ทั้งหมด", "ชีสเค้ก", "มัทฉะและชา"];
const amountToSatang = (value: string) => Math.round((Number(value) || 0) * 100);
const timeNow = () => new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" }).format(new Date());

function Dialog({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#12281e]/45 p-4" onMouseDown={onClose}>
    <section className="w-full max-w-[34rem] rounded-[1.5rem] bg-white p-5 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold text-stone-900">{title}</h2><button type="button" aria-label="ปิด" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-xl text-stone-600">×</button></div>
      {children}
    </section>
  </div>;
}

export default function POS() {
  const [activeCategory, setActiveCategory] = useState("ทั้งหมด");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [modal, setModal] = useState<Modal>("openShift");
  const [toast, setToast] = useState("");
  const [openingCash, setOpeningCash] = useState("");
  const [shiftOpen, setShiftOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [movementType, setMovementType] = useState<"in" | "out">("out");
  const [movementChannel, setMovementChannel] = useState<PaymentMethod>("cash");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  const visibleProducts = useMemo(() => products.filter((product) => (activeCategory === "ทั้งหมด" || product.category === activeCategory) && product.name.toLowerCase().includes(search.trim().toLowerCase())), [activeCategory, search]);
  const totalSatang = cart.reduce((sum, line) => sum + line.product.priceSatang * line.quantity, 0);
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cashSales = sales.filter((sale) => sale.method === "cash").reduce((sum, sale) => sum + sale.totalSatang, 0);
  const transferSales = sales.filter((sale) => sale.method === "bank_transfer").reduce((sum, sale) => sum + sale.totalSatang, 0);
  const cashIn = movements.filter((movement) => movement.channel === "cash" && movement.type === "in").reduce((sum, movement) => sum + movement.amountSatang, 0);
  const cashOut = movements.filter((movement) => movement.channel === "cash" && movement.type === "out").reduce((sum, movement) => sum + movement.amountSatang, 0);
  const expectedCash = amountToSatang(openingCash) + cashSales + cashIn - cashOut;
  const receivedSatang = amountToSatang(received);
  const changeSatang = Math.max(0, receivedSatang - totalSatang);
  const preparing = sales.filter((sale) => sale.status === "preparing");
  const completed = sales.filter((sale) => sale.status === "completed");

  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 3200); };
  const addProduct = (product: Product) => {
    if (!shiftOpen) return notify("กรุณาเปิดกะก่อนเริ่มขาย");
    if (!product.available) return notify("เมนูนี้รอตั้งราคาและเปิดขายจากหน้าสินค้า");
    setCart((current) => {
      const line = current.find((entry) => entry.product.id === product.id);
      return line ? current.map((entry) => entry.product.id === product.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...current, { product, quantity: 1 }];
    });
  };
  const changeQuantity = (id: string, delta: number) => setCart((current) => current.map((line) => line.product.id === id ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0));
  const confirmPayment = () => {
    if (!cart.length) return;
    if (paymentMethod === "cash" && receivedSatang < totalSatang) return notify("จำนวนเงินที่รับยังไม่ครบ");
    const sale: Sale = { id: sales.length + 1, lines: cart, totalSatang, method: paymentMethod, reference: reference.trim() || undefined, status: "preparing", time: timeNow() };
    setSales((current) => [sale, ...current]); setLastSale(sale); setCart([]); setReceived(""); setReference(""); setModal(null); notify(`ชำระเงินออเดอร์ #${String(sale.id).padStart(3, "0")} เรียบร้อย`);
  };
  const submitMovement = () => {
    const amountSatang = amountToSatang(movementAmount);
    if (!amountSatang || !movementReason.trim()) return notify("กรอกจำนวนเงินและเหตุผลให้ครบ");
    setMovements((current) => [{ type: movementType, channel: movementChannel, amountSatang, reason: movementReason.trim() }, ...current]);
    setMovementAmount(""); setMovementReason(""); setModal(null); notify("บันทึกรายการเงินเรียบร้อย");
  };
  const openShift = () => { setShiftOpen(true); setModal(null); notify("เปิดกะเรียบร้อย · POS 1"); };
  const closeShift = () => { if (countedCash === "") return notify("กรุณากรอกเงินสดที่นับได้จริง"); setShiftOpen(false); setCart([]); setModal(null); notify("ปิดกะและบันทึกสรุปเรียบร้อย"); };

  return <main className="min-h-screen bg-[#f7f7f2] p-3 text-stone-800 lg:h-screen lg:overflow-hidden">
    <header className="mb-3 flex min-h-[72px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dce2d9] bg-white px-4 py-3 shadow-[0_6px_20px_rgba(31,58,43,.06)]">
      <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#245b44] text-2xl shadow-sm">🌿</div><div><h1 className="text-lg font-extrabold tracking-tight">Grandfa Farm Cafe & Resort</h1><p className="text-xs text-stone-500">POS 1 · {shiftOpen ? "กะกำลังเปิด" : "ยังไม่ได้เปิดกะ"}</p></div></div>
      <nav className="hidden items-center gap-1 xl:flex" aria-label="เมนูหลัก">{["ขายสินค้า", "รายงาน", "สินค้า", "สต็อก", "พนักงาน"].map((label, index) => <button key={label} onClick={() => index === 1 && setModal("report")} className={`rounded-lg px-3 py-2 text-sm ${index === 0 ? "bg-[#e8f2eb] font-bold text-[#245b44]" : "text-stone-500 hover:bg-stone-100"}`}>{label}</button>)}</nav>
      <div className="flex items-center gap-2"><button disabled={!shiftOpen} onClick={() => setModal("cashMovement")} className="rounded-xl border border-stone-200 px-3 py-2 text-sm font-semibold text-stone-600 disabled:opacity-40">เงินเข้า-ออก</button><button onClick={() => setModal(shiftOpen ? "closeShift" : "openShift")} className={`rounded-xl px-4 py-2 text-sm font-bold text-white ${shiftOpen ? "bg-stone-800" : "bg-[#245b44]"}`}>{shiftOpen ? "ปิดกะ" : "เปิดกะ"}</button></div>
    </header>
    {toast && <div className="fixed left-1/2 top-24 z-[60] -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white shadow-xl">{toast}</div>}

    <section className="grid min-h-0 gap-3 lg:h-[calc(100vh-108px)] lg:grid-cols-[1.13fr_1fr_.95fr]">
      <section className="flex min-h-[480px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-[0_6px_20px_rgba(31,58,43,.05)] lg:min-h-0">
        <div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Menu</p><h2 className="text-xl font-extrabold">เลือกเมนู</h2></div><span className="text-xs text-stone-400">{visibleProducts.length} รายการ</span></div>
        <label className="mb-3 flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-stone-400"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-transparent text-sm text-stone-800 outline-none" placeholder="ค้นหาเมนู..." /></label>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">{categories.map((category) => <button key={category} onClick={() => setActiveCategory(category)} className={`shrink-0 rounded-xl px-3 py-2 text-sm font-bold ${activeCategory === category ? "bg-[#245b44] text-white" : "bg-stone-100 text-stone-600"}`}>{category}</button>)}</div>
        <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-3">{visibleProducts.map((product) => <button key={product.id} onClick={() => addProduct(product)} className={`min-h-32 rounded-xl border p-3 text-left transition ${product.available ? "border-stone-200 hover:-translate-y-0.5 hover:border-[#5b826c] hover:bg-[#f4faf5]" : "border-stone-100 bg-stone-50 opacity-65"}`}><div className="mb-4 text-2xl">{product.emoji}</div><p className="min-h-10 text-sm font-bold leading-5">{product.name}</p><div className="mt-2 flex items-center justify-between"><span className={`text-sm font-extrabold ${product.available ? "text-[#245b44]" : "text-amber-700"}`}>{product.available ? formatTHB(product.priceSatang) : "รอตั้งราคา"}</span><span className="grid h-6 w-6 place-items-center rounded-full bg-white text-lg text-stone-400">+</span></div></button>)}</div>
        <p className="mt-3 text-xs leading-5 text-stone-400">เมนูที่รอตั้งราคาจะไม่สามารถเพิ่มลงในบิลได้</p>
      </section>

      <section className="flex min-h-[500px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-[0_6px_20px_rgba(31,58,43,.05)] lg:min-h-0">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Current order</p><h2 className="text-xl font-extrabold">ออเดอร์ปัจจุบัน</h2></div><span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-500">{itemCount} ชิ้น</span></div>
        <div className="min-h-0 flex-1 overflow-y-auto">{!cart.length ? <div className="grid h-full min-h-56 place-items-center text-center text-stone-400"><div><div className="mb-3 text-4xl">🧺</div><p className="text-sm">เลือกเมนูเพื่อเริ่มออเดอร์</p></div></div> : cart.map((line) => <article key={line.product.id} className="flex items-center gap-2 border-b border-stone-100 py-3"><span className="text-xl">{line.product.emoji}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{line.product.name}</p><p className="text-xs text-stone-500">{formatTHB(line.product.priceSatang)} / ชิ้น</p></div><div className="flex items-center gap-1"><button onClick={() => changeQuantity(line.product.id, -1)} className="grid h-7 w-7 place-items-center rounded-lg border border-stone-200 font-bold">−</button><span className="w-5 text-center text-sm font-bold">{line.quantity}</span><button onClick={() => changeQuantity(line.product.id, 1)} className="grid h-7 w-7 place-items-center rounded-lg border border-stone-200 font-bold">+</button></div><div className="w-16 text-right text-sm font-extrabold">{formatTHB(line.product.priceSatang * line.quantity)}</div></article>)}</div>
        <div className="mt-3 border-t border-stone-200 pt-3"><div className="mb-1 flex justify-between text-sm text-stone-500"><span>ยอดรวม</span><span>{formatTHB(totalSatang)}</span></div><div className="mb-3 flex items-end justify-between"><span className="font-bold">ยอดที่ต้องชำระ</span><strong className="text-3xl tracking-tight text-[#245b44]">{formatTHB(totalSatang)}</strong></div><button disabled={!cart.length || !shiftOpen} onClick={() => setModal("checkout")} className="w-full rounded-xl bg-[#245b44] py-3.5 font-extrabold text-white shadow-sm transition hover:bg-[#1b4935] disabled:bg-stone-300">คิดเงิน · {formatTHB(totalSatang)}</button>{cart.length > 0 && <button onClick={() => window.confirm("ยกเลิกออเดอร์ที่ยังไม่ชำระหรือไม่?") && setCart([])} className="mt-2 w-full py-1 text-xs font-semibold text-stone-400 hover:text-red-600">ยกเลิกออเดอร์</button>}</div>
      </section>

      <section className="flex min-h-[480px] flex-col rounded-2xl border border-[#dce2d9] bg-white p-4 shadow-[0_6px_20px_rgba(31,58,43,.05)] lg:min-h-0">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[.12em] text-[#5b826c]">Preparation</p><h2 className="text-xl font-extrabold">ออเดอร์ชำระแล้ว</h2></div><span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">รอทำ {preparing.length}</span></div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">{!preparing.length && <div className="grid h-32 place-items-center rounded-xl border border-dashed border-stone-200 text-sm text-stone-400">ยังไม่มีออเดอร์ที่รอจัดเสิร์ฟ</div>}{preparing.map((sale) => <article key={sale.id} className="rounded-xl border border-stone-200 p-3"><div className="flex items-center justify-between"><strong>#{String(sale.id).padStart(3, "0")}</strong><span className="text-xs text-stone-400">{sale.time}</span></div><p className="mt-1 text-xs leading-5 text-stone-500">{sale.lines.map((line) => `${line.product.name} ×${line.quantity}`).join(", ")}</p><div className="mt-3 flex items-end justify-between"><div><p className="font-extrabold">{formatTHB(sale.totalSatang)}</p><p className="text-[11px] text-stone-500">{sale.method === "cash" ? "💵 เงินสด" : "↗ เงินโอน"}</p></div><button onClick={() => setSales((current) => current.map((entry) => entry.id === sale.id ? { ...entry, status: "completed" } : entry))} className="rounded-lg bg-[#245b44] px-3 py-2 text-xs font-bold text-white">✓ Done</button></div></article>)}{completed.length > 0 && <div className="pt-2"><p className="mb-1 text-xs font-bold text-stone-400">เสร็จแล้ววันนี้</p>{completed.map((sale) => <div key={sale.id} className="flex items-center justify-between border-b border-stone-100 py-2 text-xs"><span className="text-stone-500">#{String(sale.id).padStart(3, "0")} · {formatTHB(sale.totalSatang)}</span><button onClick={() => window.confirm("ย้ายกลับไปกำลังทำหรือไม่?") && setSales((current) => current.map((entry) => entry.id === sale.id ? { ...entry, status: "preparing" } : entry))} className="font-bold text-[#245b44]">ทำอีกครั้ง</button></div>)}</div>}</div>
        <button onClick={() => setModal("report")} className="mt-3 flex items-center justify-between rounded-xl bg-stone-50 p-3 text-left"><span><span className="block text-xs text-stone-500">ยอดขายในกะนี้</span><strong>{formatTHB(cashSales + transferSales)}</strong></span><span className="text-right text-xs text-stone-500">{sales.length}<br />ออเดอร์</span></button>
      </section>
    </section>

    {modal === "openShift" && <Dialog title="เปิดกะ" onClose={() => shiftOpen ? setModal(null) : undefined}><p className="mb-4 text-sm text-stone-500">ผู้ปฏิบัติงาน: <b className="text-stone-700">พนักงานหน้าร้าน</b></p><label className="block text-sm font-bold text-stone-700">เงินสดเริ่มต้นในลิ้นชัก (บาท)<input autoFocus inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="0.00" className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 text-lg outline-none focus:border-[#245b44]" /></label><button onClick={openShift} className="mt-5 w-full rounded-xl bg-[#245b44] py-3 font-extrabold text-white">ยืนยันเปิดกะ</button></Dialog>}
    {modal === "checkout" && <Dialog title="รับชำระเงิน" onClose={() => setModal(null)}><div className="mb-4 flex items-center justify-between rounded-xl bg-[#eff6f0] p-4"><span className="text-sm text-stone-600">ยอดที่ต้องชำระ</span><strong className="text-3xl text-[#245b44]">{formatTHB(totalSatang)}</strong></div><div className="mb-4 grid grid-cols-2 gap-2"><button onClick={() => setPaymentMethod("cash")} className={`rounded-xl border p-3 font-bold ${paymentMethod === "cash" ? "border-[#245b44] bg-[#eff6f0] text-[#245b44]" : "border-stone-200"}`}>💵 เงินสด</button><button onClick={() => setPaymentMethod("bank_transfer")} className={`rounded-xl border p-3 font-bold ${paymentMethod === "bank_transfer" ? "border-[#245b44] bg-[#eff6f0] text-[#245b44]" : "border-stone-200"}`}>↗ เงินโอน</button></div>{paymentMethod === "cash" ? <><label className="text-sm font-bold">รับเงินมา (บาท)<input autoFocus inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} placeholder={(totalSatang / 100).toString()} className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 text-lg outline-none focus:border-[#245b44]" /></label><div className="mt-3 flex justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"><span className="text-stone-500">เงินทอน</span><strong>{formatTHB(changeSatang)}</strong></div></> : <label className="text-sm font-bold">เลขอ้างอิงการโอน <span className="font-normal text-stone-400">(ไม่บังคับ)</span><input autoFocus value={reference} onChange={(event) => setReference(event.target.value)} placeholder="เช่น 123456" className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 outline-none focus:border-[#245b44]" /></label>}<button disabled={paymentMethod === "cash" && receivedSatang < totalSatang} onClick={confirmPayment} className="mt-5 w-full rounded-xl bg-[#245b44] py-3 font-extrabold text-white disabled:bg-stone-300">ยืนยันรับชำระเงิน</button><p className="mt-3 text-center text-xs text-stone-400">ตรวจสอบยอดแล้วจึงยืนยัน เพื่อป้องกันการชำระซ้ำ</p></Dialog>}
    {modal === "cashMovement" && <Dialog title="บันทึกเงินเข้า-ออก" onClose={() => setModal(null)}><div className="grid grid-cols-2 gap-2"><button onClick={() => setMovementType("in")} className={`rounded-xl border p-3 font-bold ${movementType === "in" ? "border-[#245b44] bg-[#eff6f0] text-[#245b44]" : "border-stone-200"}`}>เงินเข้า</button><button onClick={() => setMovementType("out")} className={`rounded-xl border p-3 font-bold ${movementType === "out" ? "border-red-300 bg-red-50 text-red-700" : "border-stone-200"}`}>เงินออก</button></div><label className="mt-4 block text-sm font-bold">ช่องทาง<select value={movementChannel} onChange={(event) => setMovementChannel(event.target.value as PaymentMethod)} className="mt-1.5 w-full rounded-xl border border-stone-200 bg-white px-3 py-3 outline-none"><option value="cash">เงินสด</option><option value="bank_transfer">เงินโอน</option></select></label><label className="mt-3 block text-sm font-bold">จำนวนเงิน (บาท)<input inputMode="decimal" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 outline-none" /></label><label className="mt-3 block text-sm font-bold">เหตุผล / รายการ<input value={movementReason} onChange={(event) => setMovementReason(event.target.value)} placeholder="เช่น เติมเงินทอน, ซื้อวัตถุดิบ" className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 outline-none" /></label><p className="mt-3 text-xs text-stone-400">เฉพาะรายการช่องทางเงินสดเท่านั้นที่มีผลต่อเงินในลิ้นชัก</p><button onClick={submitMovement} className="mt-4 w-full rounded-xl bg-[#245b44] py-3 font-extrabold text-white">บันทึกรายการ</button></Dialog>}
    {modal === "closeShift" && <Dialog title="ปิดกะ" onClose={() => setModal(null)}><div className="space-y-2 rounded-xl bg-stone-50 p-4 text-sm">{[["เงินสดเริ่มต้น", amountToSatang(openingCash)], ["ยอดขายเงินสด", cashSales], ["เงินเข้า (เงินสด)", cashIn], ["เงินออก (เงินสด)", -cashOut]].map(([label, amount]) => <div key={String(label)} className="flex justify-between"><span className="text-stone-500">{label}</span><b>{formatTHB(Number(amount))}</b></div>)}<div className="flex justify-between border-t border-stone-200 pt-2 text-base"><span className="font-bold">เงินสดที่ควรมี</span><strong className="text-[#245b44]">{formatTHB(expectedCash)}</strong></div></div><label className="mt-4 block text-sm font-bold">เงินสดที่นับได้จริง (บาท)<input autoFocus inputMode="decimal" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} className="mt-1.5 w-full rounded-xl border border-stone-200 px-3 py-3 text-lg outline-none focus:border-[#245b44]" /></label>{countedCash !== "" && <div className={`mt-3 flex justify-between rounded-lg px-3 py-2 text-sm ${amountToSatang(countedCash) - expectedCash === 0 ? "bg-[#eff6f0] text-[#245b44]" : "bg-amber-50 text-amber-800"}`}><span>เงินขาด/เกิน</span><strong>{formatTHB(amountToSatang(countedCash) - expectedCash)}</strong></div>}<button onClick={closeShift} className="mt-5 w-full rounded-xl bg-stone-800 py-3 font-extrabold text-white">ยืนยันปิดกะ</button></Dialog>}
    {modal === "report" && <Dialog title="สรุปยอดในกะ" onClose={() => setModal(null)}><div className="grid grid-cols-2 gap-3">{[["ยอดขายรวม", cashSales + transferSales], ["เงินสด", cashSales], ["เงินโอน", transferSales], ["จำนวนออเดอร์", sales.length]].map(([label, amount]) => <div key={String(label)} className="rounded-xl bg-stone-50 p-4"><p className="text-sm text-stone-500">{label}</p><p className="mt-1 text-xl font-extrabold text-stone-800">{label === "จำนวนออเดอร์" ? `${amount} รายการ` : formatTHB(Number(amount))}</p></div>)}</div><p className="mt-5 text-sm text-stone-500">ส่วนลดและการคืนเงินจะแสดงในรายงานเต็มหลังบันทึกธุรกรรมแล้ว</p></Dialog>}
    {lastSale && <aside id="receipt" className="hidden"><h1>Grandfa Farm Cafe & Resort</h1><p>ใบเสร็จ #{String(lastSale.id).padStart(3, "0")} · {lastSale.time}</p>{lastSale.lines.map((line) => <p key={line.product.id}>{line.product.name} × {line.quantity} — {formatTHB(line.product.priceSatang * line.quantity)}</p>)}<h2>รวม {formatTHB(lastSale.totalSatang)}</h2><p>{lastSale.method === "cash" ? "เงินสด" : "เงินโอน"}</p></aside>}
    {lastSale && <button onClick={() => window.print()} className="fixed bottom-4 right-4 rounded-full bg-white px-4 py-2 text-sm font-bold text-[#245b44] shadow-lg ring-1 ring-[#dce2d9]">พิมพ์ใบเสร็จล่าสุด</button>}
  </main>;
}
