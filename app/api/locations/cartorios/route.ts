import { NextResponse } from "next/server";

const UF = /^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$/;
const CNJ_API = "https://justicaabertaapi.cnj.jus.br/v1/api";

type CnjCity = { id: number; nome: string };
type CnjOffice = {
  cns?: string;
  denominacao_fantasia?: string;
  denominacao_padrao?: string;
  natureza?: string;
  status?: string;
  cidade?: string;
  uf?: string;
  endereco?: string;
  bairro?: string;
};
type CnjPage = {
  data?: CnjOffice[];
  meta?: { last_page?: number; total?: number };
};

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("pt-BR");
}

async function fetchCityId(uf: string, cityName: string) {
  const response = await fetch(`${CNJ_API}/cidades/listar/${uf}`, { next: { revalidate: 86400 } });
  if (!response.ok) throw new Error("Cidades indisponíveis no CNJ.");
  const cities = (await response.json()) as CnjCity[];
  return cities.find((city) => normalized(city.nome) === normalized(cityName))?.id;
}

async function fetchPage(uf: string, cityId: number, page: number) {
  const query = new URLSearchParams({ page: String(page), perPage: "100", assignments: "", search: "" });
  const response = await fetch(`${CNJ_API}/serventias?${query}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ cidade_id: cityId, uf, cns: null }),
  });
  if (!response.ok) throw new Error("Serventias indisponíveis no CNJ.");
  return response.json() as Promise<CnjPage>;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const uf = (params.get("uf") || "").toUpperCase();
  const city = (params.get("city") || "").trim();
  if (!UF.test(uf)) return NextResponse.json({ error: "UF inválida." }, { status: 400 });
  if (!city || city.length > 120) return NextResponse.json({ error: "Município inválido." }, { status: 400 });

  try {
    const cityId = await fetchCityId(uf, city);
    if (!cityId) return NextResponse.json({ error: "Município não localizado na base do CNJ." }, { status: 404 });

    const first = await fetchPage(uf, cityId, 1);
    const lastPage = Math.min(Math.max(first.meta?.last_page || 1, 1), 50);
    const remaining = await Promise.all(
      Array.from({ length: lastPage - 1 }, (_, index) => fetchPage(uf, cityId, index + 2))
    );
    const records = [first, ...remaining].flatMap((page) => page.data || []);

    const offices = records
      .filter((o) => o.status === "ATIVO" || !o.status)
      .map((o) => ({
        cns: o.cns || "",
        name: o.denominacao_fantasia || o.denominacao_padrao || "",
        type: o.natureza || "",
        city: o.cidade || city,
        uf: o.uf || uf,
        address: o.endereco || "",
        neighborhood: o.bairro || "",
      }))
      .filter((o) => o.name);

    return NextResponse.json(offices, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return NextResponse.json({ error: "Cartórios indisponíveis no momento." }, { status: 502 });
  }
}
