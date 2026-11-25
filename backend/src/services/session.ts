// Sessão do login — token assinado, sem dependência (nada de jsonwebtoken):
// pra um app de usuário único guardando só "autenticado até quando", um HMAC
// simples é mais fácil de auditar do que um JWT completo com headers/claims
// que a gente não usa. Formato: "<timestampExpiração>.<assinaturaHMAC>".
import crypto from "node:crypto";

export const SESSION_COOKIE_NAME = "fh_session";
export const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 dias — é o celular dele, não precisa relogar toda hora

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET não configurado no .env — gere um com `openssl rand -hex 32`.");
  }
  return secret;
}

export function createSessionToken(): string {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = String(expiresAt);
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expectedSig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

// true quando o cookie precisa da flag `secure` (só é enviado em HTTPS) —
// deriva do APP_ORIGIN em vez de NODE_ENV, porque em dev local a gente às
// vezes quer testar contra um túnel HTTPS mesmo sem estar "em produção".
export function cookieIsSecure(): boolean {
  return (process.env.APP_ORIGIN ?? "").startsWith("https://");
}
