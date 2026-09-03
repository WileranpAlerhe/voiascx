import { env } from "cloudflare:workers";

export type RuntimeEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  PINPAY_API_KEY?: string;
  PINPAY_API_BASE_URL?: string;
  PINPAY_WEBHOOK_TOKEN?: string;
  ORDER_ENCRYPTION_KEY?: string;
  VIAREGISTRO_PRICES_JSON?: string;
};

export function runtime() {
  return env as unknown as RuntimeEnv;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

export async function encryptOrderPayload(value: unknown, keyBase64?: string) {
  if (!keyBase64) throw new Error("ORDER_ENCRYPTION_KEY_NOT_CONFIGURED");
  const keyBytes = Uint8Array.from(atob(keyBase64), (character) => character.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("ORDER_ENCRYPTION_KEY_INVALID");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, clear);
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}
