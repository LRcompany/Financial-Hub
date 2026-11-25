// Freio contra força-bruta na senha de 6 dígitos (só 1 milhão de
// combinações — sem isso, um script testa todas em minutos). Em memória
// (não precisa de banco pra isso, reseta num restart do servidor, o que é
// aceitável aqui): 5 tentativas erradas trava por 15 minutos, por IP.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const attempts = new Map<string, { count: number; lockedUntil: number | null }>();

export function isLockedOut(ip: string): number | null {
  const entry = attempts.get(ip);
  if (!entry?.lockedUntil) return null;
  if (Date.now() > entry.lockedUntil) {
    attempts.delete(ip);
    return null;
  }
  return entry.lockedUntil;
}

export function recordFailedAttempt(ip: string): void {
  const entry = attempts.get(ip) ?? { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  attempts.set(ip, entry);
}

export function clearFailedAttempts(ip: string): void {
  attempts.delete(ip);
}
