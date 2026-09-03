import priceCatalog from "@/public/prices.json";
import { parsePrices } from "@/lib/catalog";

export type PriceMode = "fixed" | "location" | "subscription" | "quote";
export type PriceRecord = { amountCents: number | null; mode: PriceMode };

const catalog = priceCatalog as Record<string, PriceRecord>;

export function getPrice(serviceId: string, rawOverrides?: string): PriceRecord {
  const base = catalog[serviceId] || { amountCents: null, mode: "quote" as const };
  const override = parsePrices(rawOverrides)[serviceId];
  return {
    ...base,
    amountCents: Number.isInteger(override) ? override : base.amountCents,
  };
}
