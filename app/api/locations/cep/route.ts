import { NextResponse } from "next/server";

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

export async function GET(request: Request) {
  const cep = (new URL(request.url).searchParams.get("cep") || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cep)) {
    return NextResponse.json({ error: "Informe um CEP válido com 8 números." }, { status: 400 });
  }

  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 86400, cacheEverything: true },
  } as RequestInit);
  const result = await response.json().catch(() => null) as ViaCepResponse | null;
  if (!response.ok || !result || result.erro) {
    return NextResponse.json({ error: "CEP não encontrado.", erro: true }, { status: 404 });
  }

  return NextResponse.json({
    cep: result.cep || cep,
    logradouro: result.logradouro || "",
    complemento: result.complemento || "",
    bairro: result.bairro || "",
    localidade: result.localidade || "",
    uf: result.uf || "",
  });
}
