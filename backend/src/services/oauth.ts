// Servidor de autorização OAuth 2.1 do conector do Claude (16/10) — pra o app
// do Claude (iPhone, site, desktop) poder adicionar o Command OS como conector
// personalizado. Mesmo desenho do conector do toDo (todo.luizrodrigues.com):
// metadata de recurso protegido + servidor de autorização, registro dinâmico
// de cliente (só apps do Claude), código com PKCE S256, refresh token
// rotativo. Consentimento = senha de 6 dígitos do Command OS (mesmo freio de
// tentativas do login). Token só guardado como hash SHA-256.

import crypto from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { createSessionToken, verifySessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, cookieIsSecure } from "./session.js";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "./loginThrottle.js";

const ACCESS_TTL = 60 * 60; // 1h
const REFRESH_TTL = 90 * 24 * 60 * 60; // 90 dias, renovado a cada uso
const CODE_TTL = 10 * 60;
const SCOPE = "command-os";

const origin = () => process.env.APP_ORIGIN ?? "https://command.luizrodrigues.com";
const resourceUrl = () => `${origin()}/mcp`;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const random = (n = 32) => crypto.randomBytes(n).toString("base64url");
const inSeconds = (s: number) => new Date(Date.now() + s * 1000);

// Só os apps do Claude (e ferramenta local neste Mac) podem se registrar.
function allowedRedirect(uri: unknown): boolean {
  try {
    const u = new URL(String(uri));
    if (u.protocol === "https:" && /(^|\.)(claude\.ai|claude\.com)$/.test(u.hostname)) return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function isValidAccessToken(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha(token) } });
  return !!row && row.kind === "access" && row.expiresAt > new Date();
}

export const challengeHeader = () => `Bearer resource_metadata="${origin()}/.well-known/oauth-protected-resource"`;

async function issueTokens(clientId: string, scope: string | null, resource: string | null) {
  const access = random();
  const refresh = random();
  await prisma.$transaction([
    prisma.oAuthToken.create({ data: { tokenHash: sha(access), kind: "access", clientId, scope, resource, expiresAt: inSeconds(ACCESS_TTL) } }),
    prisma.oAuthToken.create({ data: { tokenHash: sha(refresh), kind: "refresh", clientId, scope, resource, expiresAt: inSeconds(REFRESH_TTL) } }),
    prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL, refresh_token: refresh, scope: scope || SCOPE };
}

export const oauthRouter = Router();
const cors = (_req: Request, res: Response, next: () => void) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, MCP-Protocol-Version");
  next();
};

// ---------- descoberta ----------

const protectedResource = (_req: Request, res: Response) =>
  res.json({ resource: resourceUrl(), authorization_servers: [origin()], scopes_supported: [SCOPE], bearer_methods_supported: ["header"] });
oauthRouter.get("/.well-known/oauth-protected-resource", cors, protectedResource);
oauthRouter.get("/.well-known/oauth-protected-resource/mcp", cors, protectedResource);

oauthRouter.get("/.well-known/oauth-authorization-server", cors, (_req, res) => {
  res.json({
    issuer: origin(),
    authorization_endpoint: `${origin()}/oauth/authorize`,
    token_endpoint: `${origin()}/oauth/token`,
    registration_endpoint: `${origin()}/oauth/register`,
    revocation_endpoint: `${origin()}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
  });
});

// ---------- registro dinâmico de cliente (RFC 7591) ----------

oauthRouter.options("/oauth/register", cors, (_req, res) => res.sendStatus(204));
oauthRouter.post("/oauth/register", cors, express.json(), async (req, res) => {
  const { redirect_uris: uris, client_name: name, token_endpoint_auth_method: method = "none" } = req.body ?? {};
  if (!Array.isArray(uris) || !uris.length || !uris.every(allowedRedirect)) {
    return res.status(400).json({ error: "invalid_redirect_uri", error_description: "Só os apps do Claude podem se conectar ao Command OS." });
  }
  const clientId = random(16);
  const secret = method === "none" ? null : random();
  await prisma.oAuthClient.create({
    data: { clientId, secretHash: secret ? sha(secret) : null, name: String(name || "Claude").slice(0, 80), redirectUris: JSON.stringify(uris) },
  });
  res.status(201).json({
    client_id: clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name || "Claude",
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: secret ? method : "none",
  });
});

// ---------- autorização (página de consentimento) ----------

// O formulário só carrega um nonce de uso único: os parâmetros ficam no servidor.
type Pending = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource: string;
  state?: string;
  expires: number;
};
const pending = new Map<string, Pending>();

const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Command OS · ${esc(title)}</title><style>
:root{--bg:#fff;--ink:#15171C;--soft:#6B7076;--line:#E9EAEE;--accent:#3E5BFA;--fill:#F3F4F6;--danger:#E0645A}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--ink:#F3F4F6;--soft:#A6ABB2;--line:#2A2D33;--accent:#6E85FF;--fill:#21242A;--danger:#F08A80}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Inter",system-ui,sans-serif;padding:24px}
main{width:100%;max-width:380px;display:flex;flex-direction:column;gap:16px;text-align:center}
img{width:64px;height:64px;border-radius:18px;margin:0 auto}h1{font-size:24px;font-weight:600;margin:0}
p{margin:0;color:var(--soft)}ul{text-align:left;color:var(--soft);margin:0;padding-left:20px}
input{height:56px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:22px;
text-align:center;letter-spacing:.4em;width:100%}
button{height:56px;border-radius:999px;border:0;font:inherit;font-weight:600;width:100%;cursor:pointer}
.primary{background:var(--accent);color:#fff}.muted{background:var(--fill);color:var(--ink)}.error{color:var(--danger)}
</style></head><body><main><img src="/icons/icon-192.png" alt="">${body}</main></body></html>`;
}

function consentPage(res: Response, o: { nonce: string; clientName: string; loggedIn: boolean; error?: string }) {
  res.type("html").send(
    page(
      "Permitir acesso",
      `<h1>Conectar ${esc(o.clientName)} ao Command OS?</h1>
<p>O Claude vai poder <strong>ver</strong> (sem alterar nada):</p>
<ul><li>orçamento, gastos e parcelas</li><li>patrimônio, investimentos e proventos</li><li>projetos e recebimentos</li></ul>
<form method="post" action="/oauth/authorize" style="display:flex;flex-direction:column;gap:12px">
<input type="hidden" name="nonce" value="${esc(o.nonce)}">
${o.loggedIn ? "" : '<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="Senha" aria-label="Senha de 6 dígitos" required autofocus>'}
${o.error ? `<p class="error">${esc(o.error)}</p>` : ""}
<button class="primary" name="decision" value="allow">${o.loggedIn ? "Permitir" : "Entrar e permitir"}</button>
<button class="muted" name="decision" value="deny" formnovalidate>Cancelar</button>
</form>`
    )
  );
}

const errorPage = (res: Response, msg: string) => res.status(400).type("html").send(page("Erro", `<h1>Não deu para conectar</h1><p>${esc(msg)}</p>`));

function redirectWith(res: Response, uri: string, params: Record<string, string | undefined>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  res.redirect(u.href);
}

oauthRouter.get("/oauth/authorize", async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const client = q.client_id ? await prisma.oAuthClient.findUnique({ where: { clientId: q.client_id } }) : null;
  if (!client) return errorPage(res, "App desconhecido. Remova o conector no Claude e adicione de novo.");
  if (!q.redirect_uri || !(JSON.parse(client.redirectUris) as string[]).includes(q.redirect_uri)) {
    return errorPage(res, "Endereço de retorno não autorizado.");
  }
  if (q.response_type !== "code") return redirectWith(res, q.redirect_uri, { error: "unsupported_response_type", state: q.state });
  if (!q.code_challenge || q.code_challenge_method !== "S256") {
    return redirectWith(res, q.redirect_uri, { error: "invalid_request", error_description: "PKCE S256 required", state: q.state });
  }
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  const nonce = random(24);
  pending.set(nonce, {
    clientId: client.clientId,
    clientName: client.name,
    redirectUri: q.redirect_uri,
    challenge: q.code_challenge,
    scope: q.scope || SCOPE,
    resource: q.resource || resourceUrl(),
    state: q.state,
    expires: Date.now() + CODE_TTL * 1000,
  });
  consentPage(res, { nonce, clientName: client.name, loggedIn: verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME]) });
});

// Mesma checagem de senha do login (bcrypt + freio de 5 tentativas/15min por IP).
async function checkPin(ip: string, pin: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const lockedUntil = isLockedOut(ip);
  if (lockedUntil) return { ok: false, error: `Muitas tentativas erradas — tente de novo em ${Math.ceil((lockedUntil - Date.now()) / 60000)} min.` };
  const auth = await prisma.appAuth.findFirst();
  const valid = auth && typeof pin === "string" ? await bcrypt.compare(pin, auth.pinHash) : false;
  if (!valid) {
    recordFailedAttempt(ip);
    return { ok: false, error: "Senha incorreta." };
  }
  clearFailedAttempts(ip);
  return { ok: true };
}

oauthRouter.post("/oauth/authorize", express.urlencoded({ extended: false }), async (req, res) => {
  const nonce = req.body?.nonce as string | undefined;
  const p = nonce ? pending.get(nonce) : undefined;
  if (nonce) pending.delete(nonce);
  if (!p || p.expires < Date.now()) return errorPage(res, "O pedido expirou. Tente conectar de novo pelo Claude.");
  if (req.body.decision !== "allow") return redirectWith(res, p.redirectUri, { error: "access_denied", state: p.state });

  if (!verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME])) {
    const r = await checkPin(req.ip ?? "unknown", req.body.pin);
    if (!r.ok) {
      const retry = random(24);
      pending.set(retry, { ...p, expires: Date.now() + CODE_TTL * 1000 });
      return consentPage(res, { nonce: retry, clientName: p.clientName, loggedIn: false, error: r.error });
    }
    res.cookie(SESSION_COOKIE_NAME, createSessionToken(), { httpOnly: true, secure: cookieIsSecure(), sameSite: "lax", maxAge: SESSION_MAX_AGE_MS });
  }

  const code = random();
  await prisma.oAuthCode.create({
    data: { codeHash: sha(code), clientId: p.clientId, redirectUri: p.redirectUri, challenge: p.challenge, scope: p.scope, resource: p.resource, expiresAt: inSeconds(CODE_TTL) },
  });
  redirectWith(res, p.redirectUri, { code, state: p.state });
});

// ---------- token ----------

async function clientFromRequest(req: Request) {
  let id = req.body?.client_id as string | undefined;
  let secret = req.body?.client_secret as string | undefined;
  const basic = req.get("authorization")?.match(/^Basic (.+)$/i);
  if (basic) [id, secret] = Buffer.from(basic[1], "base64").toString().split(":").map(decodeURIComponent);
  if (!id) return null;
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: id } });
  if (!client) return null;
  if (client.secretHash && sha(secret || "") !== client.secretHash) return null;
  return client;
}

const tokenError = (res: Response, error: string, description: string) => res.status(400).json({ error, error_description: description });

oauthRouter.options("/oauth/token", cors, (_req, res) => res.sendStatus(204));
oauthRouter.post("/oauth/token", cors, express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const client = await clientFromRequest(req);
  if (!client) return res.status(401).json({ error: "invalid_client" });
  const b = req.body ?? {};

  if (b.grant_type === "authorization_code") {
    const codeHash = sha(b.code || "");
    const row = await prisma.oAuthCode.findUnique({ where: { codeHash } });
    await prisma.oAuthCode.deleteMany({ where: { OR: [{ codeHash }, { expiresAt: { lt: new Date() } }] } });
    if (!row || row.expiresAt < new Date() || row.clientId !== client.clientId) return tokenError(res, "invalid_grant", "Code invalid or expired.");
    if (b.redirect_uri && b.redirect_uri !== row.redirectUri) return tokenError(res, "invalid_grant", "redirect_uri mismatch.");
    const expected = crypto.createHash("sha256").update(b.code_verifier || "").digest("base64url");
    if (expected !== row.challenge) return tokenError(res, "invalid_grant", "PKCE verification failed.");
    return res.json(await issueTokens(client.clientId, row.scope, row.resource));
  }

  if (b.grant_type === "refresh_token") {
    const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha(b.refresh_token || "") } });
    if (!row || row.kind !== "refresh" || row.expiresAt < new Date() || row.clientId !== client.clientId) {
      return tokenError(res, "invalid_grant", "Refresh token invalid or expired.");
    }
    await prisma.oAuthToken.delete({ where: { tokenHash: row.tokenHash } }); // rotação: cada refresh vale uma vez
    return res.json(await issueTokens(client.clientId, row.scope, row.resource));
  }

  tokenError(res, "unsupported_grant_type", "Use authorization_code or refresh_token.");
});

oauthRouter.post("/oauth/revoke", cors, express.urlencoded({ extended: false }), express.json(), async (req, res) => {
  await prisma.oAuthToken.deleteMany({ where: { tokenHash: sha(req.body?.token || "") } });
  res.sendStatus(200);
});
