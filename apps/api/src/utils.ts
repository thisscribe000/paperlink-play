import * as crypto from "crypto";
import { Chess } from "chess.js";

export function randomCode(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function freshGameFen() {
  const c = new Chess();
  return c.fen();
}

export function nowIso() {
  return new Date().toISOString();
}