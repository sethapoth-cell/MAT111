// ฟังก์ชันกลางของฝั่งเซิร์ฟเวอร์ (ไฟล์ขึ้นต้นด้วย _ ไม่ถูกเปิดเป็น endpoint)
const crypto = require("crypto");

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const SECRET = process.env.JWT_SECRET;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

/* ---------- Redis (Upstash REST) ---------- */
async function redis(cmd) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Error("ยังไม่ได้ตั้งค่าฐานข้อมูล (Upstash Redis)");
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (d.error) throw new Error("DB: " + d.error);
  return d.result;
}

/* ---------- รหัสผ่าน ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const real = Buffer.from(hash, "hex");
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

/* ---------- token (HMAC) ---------- */
function b64(s) { return Buffer.from(s).toString("base64url"); }
function sign(email) {
  if (!SECRET) throw new Error("ยังไม่ได้ตั้งค่า JWT_SECRET");
  const payload = b64(JSON.stringify({ e: email, exp: Date.now() + 30 * 86400000 }));
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function authEmail(req) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !SECRET) return null;
    const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.e || data.exp < Date.now()) return null;
    return data.e;
  } catch (e) { return null; }
}

/* ---------- ช่วยเหลือ ---------- */
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}
function send(res, status, obj) {
  res.status(status).setHeader("Cache-Control", "no-store").json(obj);
}
async function rateLimit(key, limit, ttl) {
  const n = await redis(["INCR", key]);
  if (n === 1) await redis(["EXPIRE", key, ttl]);
  return n <= limit;
}

/* ---------- เรียก Claude ---------- */
async function claude({ system, messages, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บนเซิร์ฟเวอร์");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 1500, system, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || "AI error " + r.status);
  return d.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

module.exports = { redis, hashPassword, verifyPassword, sign, authEmail, body, send, rateLimit, claude };