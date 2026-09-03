export const SERVICE_IDS = new Set([
  "nascimento", "casamento", "obito", "monitoramento-cpf", "monitoramento-processos", "uniao-estavel", "interdicao",
  "imovel", "penhor-safra", "pesquisa-bens", "pacote-imoveis", "procuracao", "escritura", "escritura-uniao",
  "pacto-antenupcial", "compra-venda", "doacao", "permuta", "hipoteca", "inventario", "testamento", "emancipacao",
  "divorcio", "ata-notarial", "cessao-direitos", "protesto", "pesquisa-protesto", "certificado-digital",
  "pesquisa-processos", "pesquisa-veiculo", "pesquisa-leilao", "pesquisa-gravame", "debitos-multas", "pesquisa-aeronave",
  "pesquisa-cadastro-rural", "pesquisa-inventario", "pesquisa-sintegra", "pesquisa-nascimento", "pesquisa-casamento", "pesquisa-obito",
  "antecedentes", "debitos-federais", "cndt", "stm-criminal", "mpf-negativa", "trf-distribuicao", "propriedade-aeronave",
  "ibama-embargos", "ibama-debitos", "cnj-improbidade", "fgts", "mt-cota", "mt-debitos", "mt-infracoes", "cafir", "itr",
  "stf", "stj", "tcu", "justica-estadual", "debitos-estaduais", "debitos-ambientais", "junta-comercial", "mpe-civil",
  "mpe-criminal", "pge", "trt", "debitos-municipais", "capa-iptu", "ambiental-municipal", "dados-cadastrais-imovel",
  "valor-venal", "iptu", "extrato-municipal", "traducao-apostila", "traducao", "apostilamento"
]);

export function parsePrices(raw?: string) {
  if (!raw) return {} as Record<string, number>;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => SERVICE_IDS.has(id) && Number.isInteger(value) && Number(value) >= 100)) as Record<string, number>;
  } catch {
    return {} as Record<string, number>;
  }
}
