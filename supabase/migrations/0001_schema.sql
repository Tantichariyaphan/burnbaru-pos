create extension if not exists pgcrypto;
create type employee_role as enum ('owner','manager','cashier');
create type shift_status as enum ('open','closed');
create type order_status as enum ('open','paid','preparing','completed','cancelled');
create type payment_method as enum ('cash','bank_transfer');
create type cash_move_type as enum ('in','out','refund');
create type pay_channel as enum ('cash','bank_transfer');

create table employees (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id) on delete set null,
 name text not null, email text unique not null, role employee_role not null default 'cashier', active boolean not null default true,
 created_at timestamptz not null default now()
);
create table categories (
 id uuid primary key default gen_random_uuid(), name text not null, emoji text, sort_order int not null default 0,
 active boolean not null default true, created_at timestamptz not null default now()
);
create table products (
 id uuid primary key default gen_random_uuid(), category_id uuid not null references categories(id) on delete restrict,
 name text not null, emoji text, price_satang int not null check(price_satang >= 0), available boolean not null default true,
 active boolean not null default true, sort_order int not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table shifts (
 id uuid primary key default gen_random_uuid(), register_id text not null default 'POS1', opened_by uuid not null references employees(id),
 opened_at timestamptz not null default now(), opening_cash_satang int not null check(opening_cash_satang >= 0),
 closed_by uuid references employees(id), closed_at timestamptz, counted_cash_satang int, expected_cash_satang int, variance_satang int,
 status shift_status not null default 'open'
);
create unique index one_open_shift_per_register on shifts(register_id) where status='open';
create table orders (
 id uuid primary key default gen_random_uuid(), order_no bigint generated always as identity, shift_id uuid not null references shifts(id),
 created_by uuid not null references employees(id), status order_status not null default 'open', subtotal_satang int not null default 0,
 discount_satang int not null default 0, total_satang int not null default 0, payment_method payment_method, paid_at timestamptz,
 notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete cascade,
 product_id uuid references products(id) on delete set null, name_snapshot text not null, emoji_snapshot text,
 unit_price_satang int not null check(unit_price_satang >= 0), quantity int not null check(quantity > 0), line_total_satang int not null check(line_total_satang >= 0), created_at timestamptz not null default now()
);
create table payments (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id) on delete restrict,
 shift_id uuid not null references shifts(id), method payment_method not null, amount_satang int not null check(amount_satang > 0),
 received_satang int, change_satang int, reference text, idempotency_key uuid not null unique,
 created_by uuid not null references employees(id), created_at timestamptz not null default now()
);
create table cash_movements (
 id uuid primary key default gen_random_uuid(), shift_id uuid references shifts(id), employee_id uuid not null references employees(id),
 type cash_move_type not null, channel pay_channel not null, amount_satang int not null check(amount_satang > 0), reason text not null,
 note text, created_at timestamptz not null default now()
);
create table refunds (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references orders(id), shift_id uuid references shifts(id),
 employee_id uuid not null references employees(id), channel pay_channel not null, amount_satang int not null check(amount_satang > 0),
 reason text not null, created_at timestamptz not null default now()
);
create table audit_logs (
 id uuid primary key default gen_random_uuid(), employee_id uuid references employees(id), action text not null,
 entity text, entity_id uuid, meta jsonb, created_at timestamptz not null default now()
);
-- IMPORTANT: configure RLS policies and transactional server-side RPCs before using this schema in production.
