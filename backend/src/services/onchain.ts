// Consulta de saldo direto na blockchain Solana, via endereço público (Phantom).
// Não usa nenhuma credencial — endereço público é dado aberto por natureza.

const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";

/** Saldo de SOL (em lamports) de um endereço público. */
export async function getSolBalance(publicAddress: string): Promise<number> {
  const response = await fetch(SOLANA_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [publicAddress],
    }),
  });

  const data = (await response.json()) as { result?: { value: number } };
  return data.result?.value ?? 0;
}

// TODO: pra tokens SPL (não só SOL nativo), usar getTokenAccountsByOwner
// e cruzar com uma API de cotação (ex: CoinGecko) pra converter em R$.
