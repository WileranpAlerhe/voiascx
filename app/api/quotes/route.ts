import { NextResponse } from "next/server";
import { SERVICE_IDS } from "@/lib/catalog";
import { getPrice } from "@/lib/pricing";
import { encryptOrderPayload, runtime } from "@/lib/runtime";

type QuoteBody = {
  serviceId?: string;
  serviceName?: string;
  customer?: { name?: string; email?: string; document?: string; phone?: string };
  request?: Record<string, unknown>;
};

function clean(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as QuoteBody | null;
  const serviceId = clean(body?.serviceId, 80);
  const customerName = clean(body?.customer?.name);
  const customerEmail = clean(body?.customer?.email).toLowerCase();
  if (!body || !SERVICE_IDS.has(serviceId) || getPrice(serviceId).mode !== "quote" || customerName.length < 3 || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
    return NextResponse.json({ error: "Revise o serviço, nome e e-mail." }, { status: 400 });
  }

  const current = runtime();
  const orderId = crypto.randomUUID();
  const encrypted = await encryptOrderPayload({ customer: body.customer, request: body.request }, current.ORDER_ENCRYPTION_KEY);
  const now = new Date().toISOString();
  await current.DB.prepare(`INSERT INTO orders (id, service_id, service_name, amount_cents, status, customer_email, payload_ciphertext, payload_iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(orderId, serviceId, clean(body.serviceName), 0, "quote_requested", customerEmail, encrypted.ciphertext, encrypted.iv, now, now).run();

  return NextResponse.json({ orderId, status: "quote_requested" });
}
