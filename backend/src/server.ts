import "dotenv/config";
import express from "express";
import { healthRouter } from "./routes/health.js";
import { transactionsRouter } from "./routes/transactions.js";
import { categoriesRouter } from "./routes/categories.js";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 3333;

app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", transactionsRouter);
app.use("/api", categoriesRouter);

app.listen(port, () => {
  console.log(`Financial Hub backend rodando em http://localhost:${port}`);
});
