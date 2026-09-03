export type RuntimeEnv = {
  PINPAY_API_KEY?: string;
  PINPAY_API_BASE_URL?: string;
  PINPAY_WEBHOOK_TOKEN?: string;
  ORDER_ENCRYPTION_KEY?: string;
  VIAREGISTRO_PRICES_JSON?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  hasDatabase: boolean;
};

function getEnv(): RuntimeEnv {
  return {
    PINPAY_API_KEY: process.env.PINPAY_API_KEY || process.env.PINPAY_TOKEN,
    PINPAY_API_BASE_URL: process.env.PINPAY_API_BASE_URL || "https://api.usepinpay.com",
    PINPAY_WEBHOOK_TOKEN:
      process.env.PINPAY_WEBHOOK_TOKEN || process.env.PINPAY_API_KEY || process.env.PINPAY_TOKEN,
    ORDER_ENCRYPTION_KEY: process.env.ORDER_ENCRYPTION_KEY,
    VIAREGISTRO_PRICES_JSON: process.env.VIAREGISTRO_PRICES_JSON,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    hasDatabase: Boolean(
      process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL
    ),
  };
}

export function runtime(): RuntimeEnv {
  return getEnv();
}

/** In-memory store when no Postgres is configured (preview / single instance). */
const memoryOrders = new Map<string, Record<string, unknown>>();

let schemaReady = false;

async function getSql() {
  const { sql } = await import("@vercel/postgres");
  return sql;
}

async function ensureSchema() {
  if (schemaReady || !getEnv().hasDatabase) return;
  try {
    const sql = await getSql();
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        service_id TEXT NOT NULL,
        service_name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'created',
        provider_charge_id TEXT,
        customer_email TEXT NOT NULL,
        payload_ciphertext TEXT NOT NULL,
        payload_iv TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
    schemaReady = true;
  } catch (e) {
    console.error("ensureSchema failed", e);
  }
}

export async function dbInsertOrder(row: {
  id: string;
  service_id: string;
  service_name: string;
  amount_cents: number;
  status: string;
  customer_email: string;
  payload_ciphertext: string;
  payload_iv: string;
  created_at: string;
  updated_at: string;
  provider_charge_id?: string | null;
}) {
  if (getEnv().hasDatabase) {
    await ensureSchema();
    const sql = await getSql();
    await sql`
      INSERT INTO orders (id, service_id, service_name, amount_cents, status, provider_charge_id, customer_email, payload_ciphertext, payload_iv, created_at, updated_at)
      VALUES (${row.id}, ${row.service_id}, ${row.service_name}, ${row.amount_cents}, ${row.status}, ${row.provider_charge_id ?? null}, ${row.customer_email}, ${row.payload_ciphertext}, ${row.payload_iv}, ${row.created_at}, ${row.updated_at})
    `;
  } else {
    memoryOrders.set(row.id, { ...row });
  }
}

export async function dbUpdateOrder(
  id: string,
  fields: { status?: string; provider_charge_id?: string | null; updated_at?: string }
) {
  if (getEnv().hasDatabase) {
    await ensureSchema();
    const sql = await getSql();
    const updatedAt = fields.updated_at || new Date().toISOString();
    if (fields.status !== undefined && fields.provider_charge_id !== undefined) {
      await sql`UPDATE orders SET status = ${fields.status}, provider_charge_id = ${fields.provider_charge_id}, updated_at = ${updatedAt} WHERE id = ${id}`;
    } else if (fields.status !== undefined) {
      await sql`UPDATE orders SET status = ${fields.status}, updated_at = ${updatedAt} WHERE id = ${id}`;
    }
  } else {
    const existing = memoryOrders.get(id);
    if (existing) memoryOrders.set(id, { ...existing, ...fields });
  }
}

export async function dbUpdateByProvider(providerId: string, status: string) {
  if (getEnv().hasDatabase) {
    await ensureSchema();
    const sql = await getSql();
    await sql`UPDATE orders SET status = ${status}, updated_at = ${new Date().toISOString()} WHERE provider_charge_id = ${providerId}`;
  } else {
    for (const [id, row] of memoryOrders) {
      if (row.provider_charge_id === providerId) {
        memoryOrders.set(id, { ...row, status, updated_at: new Date().toISOString() });
      }
    }
  }
}

export async function dbGetOrder(id: string) {
  if (getEnv().hasDatabase) {
    await ensureSchema();
    const sql = await getSql();
    const { rows } = await sql`SELECT id, service_name, amount_cents, status, created_at, updated_at FROM orders WHERE id = ${id}`;
    return rows[0] || null;
  }
  const row = memoryOrders.get(id);
  if (!row) return null;
  return {
    id: row.id,
    service_name: row.service_name,
    amount_cents: row.amount_cents,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function resolveEncryptionKey(explicit?: string): Promise<string> {
  if (explicit) {
    try {
      const decoded = Uint8Array.from(atob(explicit), (c) => c.charCodeAt(0));
      if (decoded.length === 32) return explicit;
    } catch {
      /* not valid base64 of 32 bytes */
    }
  }
  const seed = process.env.PINPAY_API_KEY || process.env.PINPAY_TOKEN || "viaregistro-default-key-change-me";
  const data = new TextEncoder().encode(seed + "|viaregistro-orders");
  const hash = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(hash));
}

export async function encryptOrderPayload(value: unknown, keyBase64?: string) {
  const keyB64 = await resolveEncryptionKey(keyBase64);
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("ORDER_ENCRYPTION_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, clear);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
