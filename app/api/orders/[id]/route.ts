import { NextResponse } from "next/server";
import { dbGetOrder } from "@/lib/runtime";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const row = await dbGetOrder(id);
  if (!row) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  return NextResponse.json(row);
}
