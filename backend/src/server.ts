import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";
import { budgetRouter } from "./routes/budget.js";
import { wealthRouter } from "./routes/wealth.js";
import { wealthGoalRouter } from "./routes/wealthGoal.js";
import { positionsRouter } from "./routes/positions.js";
import { projectsRouter } from "./routes/projects.js";
import { brokersRouter } from "./routes/brokers.js";
import { pluggyConnectRouter } from "./routes/pluggyConnect.js";
import { contributionsRouter } from "./routes/contributions.js";
import { pluggyWebhookRouter } from "./routes/pluggyWebhook.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { startCreditCardSyncScheduler } from "./services/scheduler.js";
import crypto from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { oauthRouter, isValidAccessToken, challengeHeader } from "./services/oauth.js";
import { buildMcpServer } from "./mcp/server.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

// Atrás de proxy reverso em produção (nginx) — sem isso, req.ip vira sempre o
// IP do proxy, e o freio de tentativas de login (por IP) trava todo mundo
// junto em vez de só quem errou a senha.
app.set("trust proxy", 1);

// Em dev, o frontend (Vite, porta 5173) e o backend rodam em portas diferentes.
// Em produção (mesmo domínio/servidor), isso deixa de ser necessário.
// `credentials: true` é obrigatório aqui — sem isso o cookie de sessão não
// é aceito/enviado entre origens diferentes (dev) nem lido pelo navegador.
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Login (senha + Face ID/Touch ID) e o webhook da Pluggy são as únicas coisas
// acessíveis sem sessão — o webhook tem sua PRÓPRIA proteção (segredo no
// header, ver pluggyWebhook.ts), não o cookie de sessão (é a Pluggy chamando,
// não o navegador do Luiz). Tudo abaixo da linha do requireAuth exige sessão.
app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", pluggyWebhookRouter);
app.use("/api", requireAuth);

app.use("/api", transactionsRouter);
app.use("/api", categoriesRouter);
app.use("/api", budgetRouter);
app.use("/api", wealthRouter);
app.use("/api", wealthGoalRouter);
app.use("/api", positionsRouter);
app.use("/api", projectsRouter);
app.use("/api", brokersRouter);
app.use("/api", pluggyConnectRouter);
app.use("/api", contributionsRouter);

// ---------- Conector do Claude (MCP, só leitura) — 16/10 ----------
// Login OAuth (app do Claude no iPhone/site) — rotas na raiz, fora de /api,
// como pede a spec de autorização do MCP (`/.well-known/...`, `/oauth/...`).
app.use(oauthRouter);

// Duas formas de entrar: o token fixo `MCP_TOKEN` do .env (Claude Code no
// Mac) ou um access token OAuth (apps do Claude). O 401 aponta pro discovery.
async function requireMcpToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const bearer = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const fixed = process.env.MCP_TOKEN;
  if (fixed && bearer) {
    const got = Buffer.from(bearer);
    const want = Buffer.from(fixed);
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return next();
  }
  if (await isValidAccessToken(bearer)) return next();
  res.set("WWW-Authenticate", challengeHeader()).status(401).json({ error: "unauthorized" });
}

// MCP sem estado: servidor + transporte novos por requisição (restart nunca
// deixa sessão órfã) — mesmo desenho do conector do toDo.
app.post("/mcp", requireMcpToken, async (req, res) => {
  // Só o nome do método (nunca argumentos) — dá pra ver quem chamou o quê.
  const msgs = Array.isArray(req.body) ? req.body : [req.body];
  console.log(`mcp: ${msgs.map((m) => (m?.method === "tools/call" ? `tools/call ${m.params?.name}` : m?.method ?? "?")).join(", ")}`);
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
  }
});
const mcpNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
app.get("/mcp", requireMcpToken, mcpNotAllowed);
app.delete("/mcp", requireMcpToken, mcpNotAllowed);

app.listen(port, () => {
  console.log(`Command OS backend rodando em http://localhost:${port}`);
  startCreditCardSyncScheduler();
});
