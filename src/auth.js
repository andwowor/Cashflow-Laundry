"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "kas_auth";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

function username() {
  return process.env.DASHBOARD_USERNAME || "admin";
}
function password() {
  return process.env.DASHBOARD_PASSWORD || "";
}
function isConfigured() {
  return password().length > 0;
}

/** Secret penanda-tangan cookie. Stabil lintas restart tanpa env tambahan,
 *  karena diturunkan dari username+password bila SESSION_SECRET tak diset. */
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return crypto.createHash("sha256").update(`kas|${username()}|${password()}`).digest("hex");
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function checkCredentials(user, pass) {
  if (!isConfigured()) return false;
  // Hash dulu agar perbandingan tidak membocorkan panjang.
  const h = (s) => crypto.createHash("sha256").update(String(s)).digest();
  const okUser = crypto.timingSafeEqual(h(user || ""), h(username()));
  const okPass = crypto.timingSafeEqual(h(pass || ""), h(password()));
  return okUser && okPass;
}

function signToken() {
  const payload = Buffer.from(JSON.stringify({ u: username(), exp: Date.now() + MAX_AGE_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!obj.exp || Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function isSecureRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setAuthCookie(req, res) {
  const flags = [
    `${COOKIE_NAME}=${signToken()}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) flags.push("Secure");
  res.setHeader("Set-Cookie", flags.join("; "));
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Middleware: lindungi semua route kecuali yang di-whitelist. */
function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  if (verifyToken(cookies[COOKIE_NAME])) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return res.redirect("/login");
}

module.exports = {
  username,
  isConfigured,
  checkCredentials,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
};
