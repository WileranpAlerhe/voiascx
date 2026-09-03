import { NextResponse } from "next/server";
import { SERVICE_IDS } from "@/lib/catalog";
import { getPrice } from "@/lib/pricing";
import { encryptOrderPayload, runtime, dbInsertOrder } from "@/lib/runtime";

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
  const body = (await request.json().catch(() => null)) as QuoteBody | null;
  const serviceId = clean(body?.serviceId, 80);
  const customerName = clean(body?.customer?.name);
  const customerEmail = clean(body?.customer?.email).toLowerCase();
  if (
    !body ||
    !SERVICE_IDS.has(serviceId) ||
    getPrice(serviceId).mode !== "quote" ||
    customerName.length < 3 ||
    !/^\S+@\S+\.\S+$/.test(customerEmail)
  ) {
    return NextResponse.json({ error: "Revise o serviço, nome e e-mail." }, { status: 400 });
  }

  const orderId = crypto.randomUUID();
  const encrypted = await encryptOrderPayload({ customer: body.customer, request: body.request }, runtime().ORDER_ENCRYPTION_KEY);
  const now = new Date().toISOString();
  await dbInsertOrder({
    id: orderId,
    service_id: serviceId,
    service_name: clean(body.serviceName),
    amount_cents: 0,
    status: "quote_requested",
    customer_email: customerEmail,
    payload_ciphertext: encrypted.ciphertext,
    payload_iv: encrypted.iv,
    created_at: now,
    updated_at: now,
  });

  return NextResponse.json({ orderId, status: "quote_requested" });
}
