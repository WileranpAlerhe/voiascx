import { NextResponse } from "next/server";
import { SERVICE_IDS } from "@/lib/catalog";
import { getPrice } from "@/lib/pricing";
import { encryptOrderPayload, runtime, dbInsertOrder, dbUpdateOrder } from "@/lib/runtime";

type CheckoutBody = {
  serviceId?: string;
  serviceName?: string;
  customer?: { name?: string; email?: string; document?: string; phone?: string };
  request?: Record<string, unknown>;
};

function clean(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function asObject(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstString(values: unknown[], max = 12000) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  }
  return null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CheckoutBody | null;
  const serviceId = clean(body?.serviceId, 80);
  const customerName = clean(body?.customer?.name);
  const customerEmail = clean(body?.customer?.email).toLowerCase();
  const customerDocument = clean(body?.customer?.document).replace(/\D/g, "").slice(0, 11);
  const customerPhone = clean(body?.customer?.phone).replace(/\D/g, "").slice(0, 11);

  if (!body || !SERVICE_IDS.has(serviceId) || customerName.length < 3 || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
    return NextResponse.json({ error: "Revise o serviço, nome e e-mail." }, { status: 400 });
  }
  if (customerDocument.length !== 11 || customerPhone.length !== 11) {
    return NextResponse.json({ error: "Revise o CPF e o celular com DDD." }, { status: 400 });
  }

  const current = runtime();
  const price = getPrice(serviceId, current.VIAREGISTRO_PRICES_JSON);
  const amountCents = price.amountCents;
  if (!amountCents || price.mode === "quote") {
    return NextResponse.json({ error: "Este serviço precisa de orçamento antes do pagamento." }, { status: 409 });
  }
  if (!current.PINPAY_API_KEY) {
    return NextResponse.json(
      { error: "O pagamento está temporariamente indisponível. Configure PINPAY_API_KEY na Vercel." },
      { status: 503 }
    );
  }

  const orderId = crypto.randomUUID();
  const encrypted = await encryptOrderPayload({ customer: body.customer, request: body.request }, current.ORDER_ENCRYPTION_KEY);
  const now = new Date().toISOString();

  await dbInsertOrder({
    id: orderId,
    service_id: serviceId,
    service_name: clean(body.serviceName),
    amount_cents: amountCents,
    status: "creating_payment",
    customer_email: customerEmail,
    payload_ciphertext: encrypted.ciphertext,
    payload_iv: encrypted.iv,
    created_at: now,
    updated_at: now,
  });

  const payload = new URLSearchParams();
  payload.set("amount", String(amountCents));
  payload.set("method", "pix");
  payload.set("expires_in", "300");
  payload.set("customer[name]", customerName);
  payload.set("customer[email]", customerEmail);
  payload.set("customer[document]", customerDocument);
  payload.set("customer[phone]", customerPhone);
  payload.set("external_id", orderId);

  const pinpay = await fetch(`${current.PINPAY_API_BASE_URL}/v1/charges`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${current.PINPAY_API_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: payload,
  });

  const result = (await pinpay.json().catch(() => ({}))) as Record<string, unknown>;
  if (!pinpay.ok) {
    await dbUpdateOrder(orderId, { status: "payment_error", updated_at: new Date().toISOString() });
    return NextResponse.json({ error: "Não foi possível gerar o Pix agora. Tente novamente." }, { status: 502 });
  }

  const pix = asObject(result.pix);
  const payment = asObject(result.payment);
  const paymentPix = asObject(payment.pix);
  const rawPixQrCode = firstString([result.pix_qrcode]);
  const pixCode = firstString([
    result.pix_code,
    result.copy_paste,
    result.pix_copy_paste,
    result.emv,
    pix.code,
    pix.copy_paste,
    pix.emv,
    paymentPix.code,
    paymentPix.copy_paste,
    rawPixQrCode && !rawPixQrCode.startsWith("data:image/") && !rawPixQrCode.startsWith("iVBOR") ? rawPixQrCode : null,
  ]);
  const qrCodeImage = firstString(
    [
      result.qr_code_image,
      result.pix_qrcode_base64,
      result.qr_code_base64,
      pix.qr_code_image,
      pix.qr_code_base64,
      paymentPix.qr_code_image,
      paymentPix.qr_code_base64,
      rawPixQrCode && (rawPixQrCode.startsWith("data:image/") || rawPixQrCode.startsWith("iVBOR")) ? rawPixQrCode : null,
    ],
    2_000_000
  );

  if (!pixCode && !qrCodeImage) {
    await dbUpdateOrder(orderId, { status: "payment_error", updated_at: new Date().toISOString() });
    return NextResponse.json({ error: "Não foi possível gerar um código Pix válido. Tente novamente." }, { status: 502 });
  }

  const providerId = clean(result.id || result.charge_id || result.transaction_id, 160);
  const status = clean(result.status || "waiting_payment", 60);
  await dbUpdateOrder(orderId, {
    status,
    provider_charge_id: providerId || null,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.json({
    orderId,
    status,
    amountCents,
    pixCode,
    qrCodeImage,
    expiresIn: Math.min(300, Math.max(30, Number(result.expires_in) || 300)),
  });
}
