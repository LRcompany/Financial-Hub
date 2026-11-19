import type { Request, Response, NextFunction } from "express";
import { verifySessionToken, SESSION_COOKIE_NAME } from "../services/session.js";

/** Trava toda rota que passar por aqui atrás do cookie de sessão. Usada como
 * gate global (server.ts, antes de todos os routers "de dado real") e
 * também dentro de authRouter pras sub-rotas que precisam estar logado
 * (trocar senha, cadastrar Face ID) — essas ficam fora do gate global porque
 * moram no mesmo router das rotas públicas de login. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME])) {
    return next();
  }
  res.status(401).json({ error: "Não autenticado." });
}
