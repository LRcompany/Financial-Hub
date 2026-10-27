import { Router } from "express";
import { runDataHealth } from "../services/integrity.js";

// GET /api/data-health (27/10) — regras de integridade dos dados agora (ver
// services/integrity.ts). Alimenta o aviso do Dashboard e a seção "Saúde dos
// dados" em Configurações.
export const dataHealthRouter = Router();

dataHealthRouter.get("/data-health", async (_req, res) => {
  res.json(await runDataHealth());
});
