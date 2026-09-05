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
import { pluggyWebhookRouter } from "./routes/pluggyWebhook.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { startCreditCardSyncScheduler } from "./services/scheduler.js";

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

app.listen(port, () => {
  console.log(`Command OS backend rodando em http://localhost:${port}`);
  startCreditCardSyncScheduler();
});
