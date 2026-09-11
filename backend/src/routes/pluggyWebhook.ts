import { Router } from "express";
import { syncAllBrokersCreditCardTransactions } from "../services/pluggyTransactionSync.js";

export const pluggyWebhookRouter = Router();

// A Pluggy não assina o payload (confirmado na doc oficial, 05/09) — a defesa
// é um segredo nosso mandado como header customizado na hora de CRIAR o
// webhook (ver tmp-import/register-pluggy-webhooks.mjs), conferido aqui.
// Pluggy exige resposta 2XX em até 10s e para de tentar de novo em 401 — por
// isso rejeita rápido, sem nem olhar o corpo, quando o segredo não bate.
function isAuthorized(req: { header: (name: string) => string | undefined }): boolean {
  const expected = process.env.PLUGGY_WEBHOOK_SECRET;
  return !!expected && req.header("x-webhook-secret") === expected;
}

// Só deixa 1 sync rodando por vez — a Pluggy manda um evento por TRANSAÇÃO
// (não por lote), então um dia com várias compras dispara vários webhooks
// quase juntos; nosso sync já é idempotente (upsert por externalId), então
// rodar em cima do outro não corrompe nada, só desperdiça chamada à Pluggy
// à toa. Se já tem um rodando, esse evento é ignorado — o sync em andamento
// já vai pegar a transação que disparou esse webhook também.
let syncInFlight = false;

async function triggerSync(reason: string) {
  if (syncInFlight) {
    console.log(`[pluggy webhook] sync já em andamento, ignorando gatilho de "${reason}"`);
    return;
  }
  syncInFlight = true;
  try {
    const result = await syncAllBrokersCreditCardTransactions();
    console.log(
      `[pluggy webhook] sync disparado por "${reason}": ${result.transactionsSynced} nova(s), ` +
        `${result.transactionsReconciled} reconciliada(s), ${result.installmentsCreated} parcela(s) futura(s).`
    );
  } catch (err) {
    console.error(`[pluggy webhook] falha no sync disparado por "${reason}":`, (err as Error).message);
  } finally {
    syncInFlight = false;
  }
}

// POST /api/webhooks/pluggy — SEM requireAuth (montada antes dele em
// server.ts): quem chama aqui é a Pluggy, não o navegador do Luiz, não tem
// cookie de sessão nenhum pra mandar.
pluggyWebhookRouter.post("/webhooks/pluggy", (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).end();
    return;
  }

  // Responde rápido (a Pluggy exige 2XX em até 10s) e só DEPOIS roda o sync
  // de verdade — não trava a resposta esperando a Pluggy inteira responder.
  res.status(200).end();

  const event = typeof req.body?.event === "string" ? req.body.event : "desconhecido";
  if (event.startsWith("transactions/")) {
    void triggerSync(event);
  }
});
