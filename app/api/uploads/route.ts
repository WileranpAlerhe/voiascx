import { NextResponse } from "next/server";
import { runtime } from "@/lib/runtime";

const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  if (!allowed.has(file.type) || file.size > 12 * 1024 * 1024) return NextResponse.json({ error: "Envie PDF, JPG, PNG ou WEBP de até 12 MB." }, { status: 400 });
  const id = crypto.randomUUID();
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "bin";
  const key = `requests/${id}.${extension}`;
  await runtime().BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name.slice(0, 160) } });
  return NextResponse.json({ uploadId: key, name: file.name });
}
