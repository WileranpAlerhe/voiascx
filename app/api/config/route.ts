import { NextResponse } from "next/server";
import { SERVICE_IDS } from "@/lib/catalog";
import { getPrice } from "@/lib/pricing";
import { runtime } from "@/lib/runtime";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("service") || "";
  if (!SERVICE_IDS.has(id)) return NextResponse.json({ error: "Serviço inválido." }, { status: 400 });
  const price = getPrice(id, runtime().VIAREGISTRO_PRICES_JSON);
  return NextResponse.json({ serviceId: id, priceCents: price.amountCents, priceMode: price.mode, paymentMethod: "pix", provider: "pinpay" });
}
