import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS, cookieIsSecure, verifySessionToken } from "../services/session.js";
import { isLockedOut, recordFailedAttempt, clearFailedAttempts } from "../services/loginThrottle.js";

export const authRouter = Router();

const PIN_RE = /^\d{6}$/;
const RP_NAME = "Command OS";

// Domínio fixo via .env, em vez de derivar do header Host da requisição —
// mais simples e mais seguro (não dá pra manipular o rpID/origin esperado
// mandando um header Host diferente). Precisa bater exatamente com a URL
// que o navegador usa pra abrir o app.
function getOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN não configurado no .env (ex: https://seu-dominio.com).");
  return origin;
}
function getRpID(): string {
  return new URL(getOrigin()).hostname;
}

function setSessionCookie(res: import("express").Response) {
  res.cookie(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: cookieIsSecure(),
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
  });
}

function clientIp(req: import("express").Request): string {
  return req.ip ?? "unknown";
}

// GET /api/auth/status — pública. A tela de bloqueio usa isso pra decidir o
// que mostrar: setup (sem senha ainda), senha/Face ID (não autenticado), ou
// deixar passar direto (sessão válida).
authRouter.get("/auth/status", async (req, res) => {
  const authenticated = verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
  const [auth, credentialCount] = await Promise.all([prisma.appAuth.findFirst(), prisma.webauthnCredential.count()]);
  res.json({ authenticated, hasPinConfigured: !!auth, hasWebauthnCredential: credentialCount > 0 });
});

// POST /api/auth/setup — primeiro acesso. Só funciona uma vez (enquanto não
// existir AppAuth) — depois disso, mudar a senha é PUT /auth/pin (autenticado).
authRouter.post("/auth/setup", async (req, res) => {
  const existing = await prisma.appAuth.findFirst();
  if (existing) {
    return res.status(409).json({ error: "Senha já configurada — use a tela de login." });
  }
  const { pin } = req.body ?? {};
  if (typeof pin !== "string" || !PIN_RE.test(pin)) {
    return res.status(400).json({ error: "A senha precisa ter exatamente 6 dígitos numéricos." });
  }
  const pinHash = await bcrypt.hash(pin, 12);
  await prisma.appAuth.create({ data: { pinHash } });
  setSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/login — senha de 6 dígitos. Freio de 5 tentativas / 15min por IP.
authRouter.post("/auth/login", async (req, res) => {
  const ip = clientIp(req);
  const lockedUntil = isLockedOut(ip);
  if (lockedUntil) {
    return res.status(429).json({ error: `Muitas tentativas erradas — tente de novo em ${Math.ceil((lockedUntil - Date.now()) / 60000)} min.` });
  }

  const { pin } = req.body ?? {};
  const auth = await prisma.appAuth.findFirst();
  const valid = auth && typeof pin === "string" ? await bcrypt.compare(pin, auth.pinHash) : false;
  if (!valid) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: "Senha incorreta." });
  }

  clearFailedAttempts(ip);
  setSessionCookie(res);
  res.json({ ok: true });
});

// POST /api/auth/logout
authRouter.post("/auth/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME);
  res.json({ ok: true });
});

// PUT /api/auth/pin — trocar a senha (autenticado + confirma a senha atual).
authRouter.put("/auth/pin", requireAuth, async (req, res) => {
  const { currentPin, newPin } = req.body ?? {};
  if (typeof newPin !== "string" || !PIN_RE.test(newPin)) {
    return res.status(400).json({ error: "A nova senha precisa ter exatamente 6 dígitos numéricos." });
  }
  const auth = await prisma.appAuth.findFirst();
  if (!auth) return res.status(404).json({ error: "Nenhuma senha configurada ainda." });

  const valid = typeof currentPin === "string" && (await bcrypt.compare(currentPin, auth.pinHash));
  if (!valid) return res.status(401).json({ error: "Senha atual incorreta." });

  const pinHash = await bcrypt.hash(newPin, 12);
  await prisma.appAuth.update({ where: { id: auth.id }, data: { pinHash } });
  res.json({ ok: true });
});

// Challenge do WebAuthn em memória — uso pessoal, um fluxo de cada vez, não
// precisa de tabela/sessão de challenge por usuário pra isso.
let currentChallenge: string | null = null;

// POST /api/auth/webauthn/register-options — autenticado (só cadastra Face
// ID/Touch ID novo depois de já ter provado quem é pela senha).
authRouter.post("/auth/webauthn/register-options", requireAuth, async (_req, res) => {
  const existing = await prisma.webauthnCredential.findMany();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: getRpID(),
    userName: "luiz",
    userDisplayName: "Luiz Rodrigues",
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred", authenticatorAttachment: "platform" },
  });
  currentChallenge = options.challenge;
  res.json(options);
});

// POST /api/auth/webauthn/register-verify — autenticado.
authRouter.post("/auth/webauthn/register-verify", requireAuth, async (req, res) => {
  const { response, deviceLabel } = req.body ?? {};
  if (!currentChallenge) {
    return res.status(400).json({ error: "Nenhum cadastro em andamento — peça as opções de novo." });
  }
  try {
    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: currentChallenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
    });
    currentChallenge = null;
    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Não consegui confirmar o cadastro do Face ID/Touch ID." });
    }
    const { credential } = verification.registrationInfo;
    await prisma.webauthnCredential.create({
      data: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports ? JSON.stringify(credential.transports) : null,
        deviceLabel: typeof deviceLabel === "string" && deviceLabel.trim() ? deviceLabel.trim() : "Aparelho sem nome",
      },
    });
    res.json({ ok: true });
  } catch (err) {
    currentChallenge = null;
    res.status(400).json({ error: `Falha ao cadastrar: ${(err as Error).message}` });
  }
});

// POST /api/auth/webauthn/login-options — pública (é a tela de bloqueio usando).
authRouter.post("/auth/webauthn/login-options", async (_req, res) => {
  const creds = await prisma.webauthnCredential.findMany();
  if (creds.length === 0) {
    return res.status(404).json({ error: "Nenhum Face ID/Touch ID cadastrado ainda." });
  }
  const options = await generateAuthenticationOptions({
    rpID: getRpID(),
    allowCredentials: creds.map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    userVerification: "preferred",
  });
  currentChallenge = options.challenge;
  res.json(options);
});

// POST /api/auth/webauthn/login-verify — pública, é o próprio login por Face ID/Touch ID.
authRouter.post("/auth/webauthn/login-verify", async (req, res) => {
  const ip = clientIp(req);
  const lockedUntil = isLockedOut(ip);
  if (lockedUntil) {
    return res.status(429).json({ error: "Muitas tentativas — tente de novo mais tarde." });
  }

  const response = req.body?.response as AuthenticationResponseJSON | undefined;
  if (!currentChallenge || !response) {
    return res.status(400).json({ error: "Sessão de login expirada — tente de novo." });
  }

  const stored = await prisma.webauthnCredential.findUnique({ where: { id: response.id } });
  if (!stored) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: "Credencial não reconhecida." });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: currentChallenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpID(),
      credential: {
        id: stored.id,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports ? JSON.parse(stored.transports) : undefined,
      },
    });
    currentChallenge = null;
    if (!verification.verified) {
      recordFailedAttempt(ip);
      return res.status(401).json({ error: "Não consegui confirmar o Face ID/Touch ID." });
    }
    await prisma.webauthnCredential.update({
      where: { id: stored.id },
      data: { counter: verification.authenticationInfo.newCounter },
    });
    clearFailedAttempts(ip);
    setSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    currentChallenge = null;
    recordFailedAttempt(ip);
    res.status(401).json({ error: `Falha na verificação: ${(err as Error).message}` });
  }
});

// GET /api/auth/webauthn/credentials — autenticado, lista pra Configurações.
authRouter.get("/auth/webauthn/credentials", requireAuth, async (_req, res) => {
  const creds = await prisma.webauthnCredential.findMany({ orderBy: { createdAt: "desc" } });
  res.json(creds.map((c) => ({ id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt })));
});

// DELETE /api/auth/webauthn/:id — autenticado, remove um aparelho cadastrado.
authRouter.delete("/auth/webauthn/:id", requireAuth, async (req, res) => {
  await prisma.webauthnCredential.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true });
});
