import { NextResponse } from "next/server";

const UF = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;

export async function GET(request: Request) {
  const uf = (new URL(request.url).searchParams.get("uf") || "").toUpperCase();
  if (!UF.test(uf)) return NextResponse.json({ error: "UF inválida." }, { status: 400 });
  try {
    const response = await fetch(`https://justicaabertaapi.cnj.jus.br/v1/api/cidades/listar/${uf}`, {
      next: { revalidate: 86400 },
    });
    if (!response.ok) throw new Error("CNJ indisponível");
    const data = (await response.json()) as Array<{ id: number; nome: string }>;
    return NextResponse.json(
      data.map(({ id, nome }) => ({ id, nome })),
      { headers: { "Cache-Control": "public, max-age=86400" } }
    );
  } catch {
    return NextResponse.json({ error: "Municípios indisponíveis." }, { status: 502 });
  }
}
