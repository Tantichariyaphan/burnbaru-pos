export type PosProduct = {
  id: string;
  name: string;
  emoji: string | null;
  price_satang: number;
  available: boolean;
  category_id: string;
  sort_order: number;
};

export type PosCategory = {
  id: string;
  name: string;
  emoji: string | null;
  products: PosProduct[];
};

export type PosOrderItem = {
  id: string;
  product_id?: string | null;
  name_snapshot: string;
  emoji_snapshot: string | null;
  unit_price_satang: number;
  quantity: number;
  line_total_satang: number;
  category_name_snapshot?: string;
};

export type PosOrder = {
  id: string;
  order_no: number;
  subtotal_satang: number;
  discount_satang: number;
  tax_satang: number;
  total_satang: number;
  payment_method: "cash" | "bank_transfer" | null;
  status: "open" | "paid" | "preparing" | "completed" | "cancelled";
  paid_at: string | null;
  created_at: string;
  order_items: PosOrderItem[];
  payments?: PosPayment[];
  refunds?: PosRefund[];
  receipts?: PosReceipt[];
  employee?: { name: string } | { name: string }[] | null;
};

export type PosPayment = {
  id: string;
  method: "cash" | "bank_transfer";
  amount_satang: number;
  received_satang: number | null;
  change_satang: number | null;
  reference: string | null;
  created_at: string;
};

export type PosRefund = {
  id: string;
  channel: "cash" | "bank_transfer";
  amount_satang: number;
  reason: string;
  created_at: string;
};

export type PosReceipt = {
  id: string;
  receipt_no: number;
  snapshot: {
    order_no: number;
    created_at: string;
    paid_at: string;
    employee_name: string;
    subtotal_satang: number;
    discount_satang: number;
    tax_satang: number;
    total_satang: number;
    payment_method: "cash" | "bank_transfer";
    reference: string | null;
    items: Array<{
      name: string;
      emoji: string | null;
      quantity: number;
      unit_price_satang: number;
      line_total_satang: number;
    }>;
  };
};

export type PosShift = {
  id: string;
  register_id: string;
  opening_cash_satang: number;
  opened_at: string;
  opened_by?: string;
};

export type PosData = {
  employee: { id: string; name: string; role: "owner" | "manager" | "cashier" };
  categories: PosCategory[];
  activeShift: PosShift | null;
  taxConfiguration: { enabled: boolean; rate_bps: number };
  queue: PosOrder[];
  employees?: Array<{ id: string; name: string }>;
};
