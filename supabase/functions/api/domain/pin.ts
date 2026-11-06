/**
 * PIN del colaborador. Funciona igual en Deno (producción) y Node (seed y pruebas).
 *
 * Un PIN de 6 dígitos tiene un millón de combinaciones: el hash solo protege de verdad
 * junto con el bloqueo por intentos. Por eso nunca se usa como contraseña de Supabase Auth.
 */
export const MAX_PIN_ATTEMPTS = 5;
const ITERATIONS = 150_000;

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (size: number) => hex(crypto.getRandomValues(new Uint8Array(size)));

async function derive(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: ITERATIONS }, key, 256));
}

export async function hashPin(pin: string): Promise<{ salt: string; pinHash: string }> {
  const salt = randomHex(16);
  return { salt, pinHash: await derive(pin, salt) };
}

/**
 * Sin registro también calcula un hash: una cédula inventada tarda lo mismo que una real
 * con el PIN equivocado.
 */
export async function verifyPin(pin: string, stored: { salt: string; pin_hash: string } | null): Promise<boolean> {
  const computed = await derive(pin, stored?.salt ?? "0".repeat(32));
  if (!stored || computed.length !== stored.pin_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ stored.pin_hash.charCodeAt(i);
  return diff === 0;
}

/** Contraseña real en Supabase Auth: aleatoria, no se le muestra a nadie. */
export const newAuthSecret = () => randomHex(32);

/** Clave del contador de intentos. Con hash, para no guardar cédulas en esa tabla. */
export async function attemptKey(companyCode: string, cedula: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`pin:${companyCode}:${cedula}`)));
}
