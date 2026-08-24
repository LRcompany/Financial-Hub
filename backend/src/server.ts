import "dotenv/config";
import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";
import { budgetRouter } from "./routes/budget.js";
import { wealthRouter } from "./routes/wealth.js";
import { projectsRouter } from "./routes/projects.js";
import { brokersRouter } from "./routes/brokers.js";
import { pluggyConnectRouter } from "./routes/pluggyConnect.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

// Em dev, o frontend (Vite, porta 5173) e o backend rodam em portas diferentes.
// Em produção (mesmo domínio/servidor), isso deixa de ser necessário.
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", transactionsRouter);
app.use("/api", categoriesRouter);
app.use("/api", budgetRouter);
app.use("/api", wealthRouter);
app.use("/api", projectsRouter);
app.use("/api", brokersRouter);
app.use("/api", pluggyConnectRouter);

app.listen(port, () => {
  console.log(`Financial Hub backend rodando em http://localhost:${port}`);
});
