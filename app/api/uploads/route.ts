import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { runtime } from "@/lib/runtime";

const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  if (!allowed.has(file.type) || file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Arquivo inválido. Use PDF/JPG/PNG/WEBP até 8MB." }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 6) || "bin";
  const key = `requests/${id}.${extension}`;

  const token = runtime().BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const blob = await put(key, file, {
        access: "public",
        token,
        contentType: file.type,
      });
      return NextResponse.json({ uploadId: blob.url, name: file.name });
    } catch (e) {
      console.error("blob upload failed", e);
    }
  }

  // Fallback: accept without storing (frontend can still proceed)
  return NextResponse.json({ uploadId: key, name: file.name, stored: false });
}
