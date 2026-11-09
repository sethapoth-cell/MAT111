const L = require("./_lib");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  try {
    // GET: ตรวจ token และดึงข้อมูลผู้ใช้
    if (req.method === "GET") {
      const email = L.authEmail(req);
      if (!email) return L.send(res, 401, { error: "กรุณาเข้าสู่ระบบอีกครั้ง" });
      const raw = await L.redis(["GET", "user:" + email]);
      if (!raw) return L.send(res, 401, { error: "ไม่พบบัญชี" });
      return L.send(res, 200, { user: { email, name: JSON.parse(raw).name } });
    }
    if (req.method !== "POST") return L.send(res, 405, { error: "Method not allowed" });

    const b = L.body(req);
    const action = b.action;
    const email = String(b.email || "").trim().toLowerCase();
    const password = String(b.password || "");

    if (!EMAIL_RE.test(email) || email.length > 120) return L.send(res, 400, { error: "อีเมลไม่ถูกต้อง" });
    if (password.length < 8 || password.length > 100) return L.send(res, 400, { error: "รหัสผ่านต้องยาว 8 ตัวอักษรขึ้นไป" });

    if (action === "register") {
      const name = String(b.name || "").trim().slice(0, 40) || email.split("@")[0];
      const user = JSON.stringify({ name, pass: L.hashPassword(password), created: Date.now() });
      // NX = สร้างได้เฉพาะเมื่อยังไม่มีอีเมลนี้
      const ok = await L.redis(["SET", "user:" + email, user, "NX"]);
      if (!ok) return L.send(res, 409, { error: "อีเมลนี้ถูกใช้งานแล้ว" });
      return L.send(res, 200, { token: L.sign(email), user: { email, name } });
    }

    if (action === "login") {
      // กันเดารหัสผ่าน: ผิดเกิน 8 ครั้งใน 15 นาที ให้รอ
      const allowed = await L.rateLimit("lf:" + email, 8, 900);
      if (!allowed) return L.send(res, 429, { error: "ลองบ่อยเกินไป รอ 15 นาทีแล้วลองใหม่" });
      const raw = await L.redis(["GET", "user:" + email]);
      const u = raw ? JSON.parse(raw) : null;
      if (!u || !L.verifyPassword(password, u.pass)) return L.send(res, 401, { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
      return L.send(res, 200, { token: L.sign(email), user: { email, name: u.name } });
    }

    return L.send(res, 400, { error: "คำสั่งไม่ถูกต้อง" });
  } catch (e) {
    return L.send(res, 500, { error: e.message });
  }
};