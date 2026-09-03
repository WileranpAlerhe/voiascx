import { NextResponse } from "next/server";
import { runtime } from "@/lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await runtime().DB.prepare("SELECT id, service_name, amount_cents, status, created_at, updated_at FROM orders WHERE id = ?").bind(id).first();
  if (!row) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  return NextResponse.json(row);
}
