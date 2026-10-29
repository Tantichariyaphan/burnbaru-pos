export type PosProduct = {
  id: string;
  name: string;
  emoji: string | null;
  price_satang: number;
  available: boolean;
  category_id: string;
};

export type PosCategory = {
  id: string;
  name: string;
  emoji: string | null;
  products: PosProduct[];
};

export type PosOrderItem = {
  id: string;
  name_snapshot: string;
  emoji_snapshot: string | null;
  unit_price_satang: number;
  quantity: number;
  line_total_satang: number;
};

export type PosOrder = {
  id: string;
  order_no: number;
  total_satang: number;
  payment_method: "cash" | "bank_transfer" | null;
  status: "open" | "paid" | "preparing" | "completed" | "cancelled";
  paid_at: string | null;
  created_at: string;
  order_items: PosOrderItem[];
};

export type PosShift = {
  id: string;
  opening_cash_satang: number;
  opened_at: string;
};

export type PosData = {
  employeeName: string;
  employeeRole: "owner" | "manager" | "cashier";
  categories: PosCategory[];
  activeShift: PosShift | null;
  queue: PosOrder[];
};
