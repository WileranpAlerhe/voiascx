import { NextResponse } from "next/server";
import { runtime, dbUpdateByProvider } from "@/lib/runtime";

export async function POST(request: Request) {
  const current = runtime();
  const token = new URL(request.url).searchParams.get("token") || "";
  const expected = current.PINPAY_WEBHOOK_TOKEN || current.PINPAY_API_KEY;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const event = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const providerId = String(event?.id || event?.charge_id || event?.transaction_id || "").slice(0, 160);
  const status = String(event?.status || "").slice(0, 60);
  if (!providerId || !status) return NextResponse.json({ error: "Evento inválido." }, { status: 400 });
  await dbUpdateByProvider(providerId, status);
  return NextResponse.json({ received: true });
}
