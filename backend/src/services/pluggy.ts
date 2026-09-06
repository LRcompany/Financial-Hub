// Integração com a API da Pluggy (Open Finance).
// Endpoints confirmados em docs.pluggy.ai e testados manualmente em 20/08/2026
// (ver docs/blueprint.md — BTG confirmado com dado real, Sofisa sem investimento).

const PLUGGY_BASE_URL = "https://api.pluggy.ai";

let cachedApiKey: { key: string; expiresAt: number } | null = null;

/** Autentica e retorna a API Key (válida por 2h) — cacheia em memória entre chamadas. */
export async function getPluggyApiKey(): Promise<string> {
  if (cachedApiKey && cachedApiKey.expiresAt > Date.now()) {
    return cachedApiKey.key;
  }

  const response = await fetch(`${PLUGGY_BASE_URL}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.PLUGGY_CLIENT_ID,
      clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha na autenticação Pluggy: ${response.status}`);
  }

  const data = (await response.json()) as { apiKey: string };
  // Cacheia por 1h50 (margem de segurança sobre as 2h reais)
  cachedApiKey = { key: data.apiKey, expiresAt: Date.now() + 110 * 60 * 1000 };
  return data.apiKey;
}

async function pluggyGet<T>(path: string): Promise<T> {
  const apiKey = await getPluggyApiKey();
  const response = await fetch(`${PLUGGY_BASE_URL}${path}`, {
    headers: { "X-API-KEY": apiKey },
  });
  if (!response.ok) {
    throw new Error(`Pluggy GET ${path} falhou: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function pluggyPost<T>(path: string, body: unknown): Promise<T> {
  const apiKey = await getPluggyApiKey();
  const response = await fetch(`${PLUGGY_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Pluggy POST ${path} falhou: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

/** Detalhes + status de sincronização de uma conexão (item). Não existe endpoint pra listar todos — o itemId vem do Dashboard. */
export function getItem(itemId: string) {
  return pluggyGet(`/items/${itemId}`);
}

export function getAccounts(itemId: string) {
  return pluggyGet(`/accounts?itemId=${itemId}`);
}

export function getInvestments(itemId: string) {
  return pluggyGet(`/investments?itemId=${itemId}`);
}

// v1 /transactions retorna 410 (deprecado) — confirmado em 29/08. v2 não
// aceita pageSize (ignora o parâmetro se mandar), então só accountId mesmo.
export function getTransactions(accountId: string) {
  return pluggyGet(`/v2/transactions?accountId=${accountId}`);
}

/**
 * Cria um Connect Token pro widget (docs.pluggy.ai/reference/connect-token-create).
 * Sem itemId: abre o widget pra conectar um banco novo.
 * Com itemId: abre em modo "atualização" daquela conexão existente (reautenticar/MFA vencido).
 */
export async function createConnectToken(itemId?: string): Promise<{ accessToken: string }> {
  const apiKey = await getPluggyApiKey();
  const response = await fetch(`${PLUGGY_BASE_URL}/connect_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify(itemId ? { itemId } : {}),
  });
  if (!response.ok) {
    throw new Error(`Falha ao criar connect token: ${response.status}`);
  }
  return response.json() as Promise<{ accessToken: string }>;
}

// Sync de transação real: ver services/pluggyTransactionSync.ts (31/08).

// Webhook (05/09) — em vez de só esperar o sync 1x/dia (e às vezes bater
// ANTES da Pluggy ter atualizado o dia com o banco, ficando 1 dia inteiro
// atrasado sem necessidade), a Pluggy avisa a gente NA HORA que tem
// transação nova/atualizada (docs.pluggy.ai/docs/webhooks). Direto na API —
// não existe endpoint de listar webhook por item, só criar/consultar por id.
export function createWebhook(event: string, url: string, headers?: Record<string, string>) {
  return pluggyPost<{ id: string; url: string; event: string }>("/webhooks", { event, url, headers });
}
