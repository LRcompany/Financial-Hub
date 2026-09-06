import { Router } from "express";
import { prisma } from "../prisma.js";

export const wealthGoalRouter = Router();

// GET /api/wealth-goal — meta geral: valor alvo + aporte mensal pretendido.
// Simplificado (01/09): antes existia uma tabela ano a ano com "retorno
// assumido" chutado — o retorno agora vem calculado de verdade a partir do
// histórico real (ver /wealth-overview), só o aporte mensal continua sendo
// informado por ele (é intenção futura, não tem como derivar do passado).
wealthGoalRouter.get("/wealth-goal", async (_req, res) => {
  const goal = await prisma.wealthGoal.findFirst();
  res.json({ targetAmount: goal?.targetAmount ?? null, monthlyContribution: goal?.monthlyContribution ?? 0 });
});

// PUT /api/wealth-goal — define/atualiza a meta (singleton). Os dois campos
// são opcionais individualmente — mandar só um não apaga o outro.
wealthGoalRouter.put("/wealth-goal", async (req, res) => {
  const { targetAmount, monthlyContribution } = req.body ?? {};
  if (targetAmount !== undefined && (typeof targetAmount !== "number" || targetAmount <= 0)) {
    return res.status(400).json({ error: "targetAmount precisa ser um número positivo" });
  }
  if (monthlyContribution !== undefined && (typeof monthlyContribution !== "number" || monthlyContribution < 0)) {
    return res.status(400).json({ error: "monthlyContribution precisa ser um número >= 0" });
  }

  const existing = await prisma.wealthGoal.findFirst();
  const data = {
    ...(targetAmount !== undefined ? { targetAmount } : {}),
    ...(monthlyContribution !== undefined ? { monthlyContribution } : {}),
  };
  const goal = existing
    ? await prisma.wealthGoal.update({ where: { id: existing.id }, data })
    : await prisma.wealthGoal.create({
        data: { targetAmount: targetAmount ?? 1000000, monthlyContribution: monthlyContribution ?? 0 },
      });
  res.json(goal);
});
