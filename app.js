/* PlantCare AI — ฝั่งหน้าเว็บ (ระบบสมาชิก + เรียก AI ผ่านเซิร์ฟเวอร์) */
(function () {
  "use strict";

  var DAY = PC_DATA.dayMs;

  // ผู้ใช้ที่ตั้งค่าลดการเคลื่อนไหว: หยุดแอนิเมชันของภาพหน้าปก
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) {
    var sp = document.getElementById("sprite");
    if (sp && sp.pauseAnimations) sp.pauseAnimations();
  }
  var state = { image: null, water: 3, light: "ในร่ม", lastResult: null, chat: [], authMode: "login" };
  var session = { token: localStorage.getItem("pc_token") || "", user: null };
  var plants = [];
  var chatContext = null;

  /* ---------- helper ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function cacheKey() { return "pc_plants:" + (session.user ? session.user.email : ""); }

  /* ---------- เรียก API ของเรา ---------- */
  function api(path, method, data) {
    var opts = { method: method || "GET", headers: { "Content-Type": "application/json" } };
    if (session.token) opts.headers.Authorization = "Bearer " + session.token;
    if (data) opts.body = JSON.stringify(data);
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (d) {
        if (res.status === 401 && session.token && path !== "/api/auth") {
          logout(true);
        }
        if (!res.ok) {
          var e = new Error(d.error || ("เกิดข้อผิดพลาด (" + res.status + ")"));
          e.status = res.status;
          throw e;
        }
        return d;
      });
    }, function () {
      throw new Error("เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่");
    });
  }

  /* ---------- การนำทาง ---------- */
  function go(name) {
    if (!session.user && name !== "auth") name = "auth";
    $(".app").classList.toggle("noauth", name === "auth");
    $$(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    var tabName = name === "result" ? "analyze" : name;
    $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.goto === tabName); });
    var v = $("#view-" + name);
    if (v) v.scrollTop = 0;
    if (name === "home") renderHome();
    if (name === "plants") renderPlants();
    if (name === "chat") initChat();
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-goto]");
    if (el) go(el.dataset.goto);
  });

  /* ---------- บัญชีผู้ใช้ ---------- */
  $$("#view-auth .auth-tabs .chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.authMode = chip.dataset.mode;
      $$("#view-auth .auth-tabs .chip").forEach(function (c) { c.classList.toggle("selected", c === chip); });
      var reg = state.authMode === "register";
      $("#name-wrap").classList.toggle("hidden", !reg);
      $("#auth-submit").textContent = reg ? "สมัครสมาชิก" : "เข้าสู่ระบบ";
      $("#auth-pass").autocomplete = reg ? "new-password" : "current-password";
      setAuthError("");
    });
  });
  function setAuthError(msg) {
    var el = $("#auth-error");
    el.textContent = msg; el.classList.toggle("hidden", !msg);
  }

  $("#auth-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("#auth-email").value.trim();
    var pass = $("#auth-pass").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { setAuthError("กรอกอีเมลให้ถูกต้อง"); return; }
    if (pass.length < 8) { setAuthError("รหัสผ่านต้องยาว 8 ตัวอักษรขึ้นไป"); return; }
    var btn = $("#auth-submit");
    btn.disabled = true; setAuthError("");
    api("/api/auth", "POST", {
      action: state.authMode, email: email, password: pass, name: $("#auth-name").value.trim()
    }).then(function (d) {
      session.token = d.token; session.user = d.user;
      localStorage.setItem("pc_token", d.token);
      $("#auth-pass").value = "";
      return startSession();
    }).catch(function (err) {
      setAuthError(err.message);
    }).then(function () { btn.disabled = false; });
  });

  function logout(expired) {
    session.token = ""; session.user = null; plants = [];
    localStorage.removeItem("pc_token"); localStorage.removeItem("pc_user");
    state.chat = []; state.lastResult = null; state.image = null;
    $("#modal").classList.add("hidden");
    go("auth");
    if (expired) setAuthError("หมดเวลาเข้าสู่ระบบ กรุณาเข้าสู่ระบบอีกครั้ง");
  }

  // โหลดต้นไม้จากเซิร์ฟเวอร์ (ถ้าออฟไลน์ใช้แคชในเครื่อง)
  function startSession() {
    if (session.user) localStorage.setItem("pc_user", JSON.stringify(session.user));
    return api("/api/plants").then(function (d) {
      plants = d.plants || [];
      localStorage.setItem(cacheKey(), JSON.stringify(plants));
    }).catch(function () {
      try { plants = JSON.parse(localStorage.getItem(cacheKey()) || "[]"); } catch (e) { plants = []; }
      toast("ใช้ข้อมูลที่เก็บไว้ในเครื่อง (ออฟไลน์)");
    }).then(function () {
      go("home");
      checkReminders();
    });
  }

  var syncTimer;
  function savePlants() {
    try { localStorage.setItem(cacheKey(), JSON.stringify(plants)); } catch (e) { /* ignore */ }
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      api("/api/plants", "PUT", { plants: plants }).catch(function (err) {
        toast("ซิงก์ไม่สำเร็จ: " + err.message);
      });
    }, 600);
  }

  function boot() {
    if (!session.token) { go("auth"); return; }
    $("#loading").classList.remove("hidden");
    api("/api/auth").then(function (d) {
      session.user = d.user;
      return startSession();
    }).catch(function (err) {
      if (err.status === 401) { go("auth"); }
      else {
        // เครือข่ายล่ม: ลองใช้ข้อมูลที่เคยล็อกอินไว้
        var u = null;
        try { u = JSON.parse(localStorage.getItem("pc_user") || "null"); } catch (e) { /* ignore */ }
        if (u) { session.user = u; startSession(); } else { go("auth"); setAuthError(err.message); }
      }
    }).then(function () { $("#loading").classList.add("hidden"); });
  }

  /* ---------- หน้าแรก ---------- */
  function duePlants() {
    var limit = Date.now() + DAY * 0.5;
    return plants.filter(function (p) { return p.nextWater <= limit; });
  }
  function renderHome() {
    var due = duePlants();
    $("#stat-plants").textContent = plants.length;
    $("#stat-reminders").textContent = due.length;
    $("#tab-badge").classList.toggle("hidden", due.length === 0);
    var box = $("#home-due");
    if (due.length) {
      box.classList.remove("hidden");
      box.innerHTML = "<b>ถึงเวลารดน้ำแล้ว</b>" + due.map(function (p) { return esc(p.name); }).join(", ");
    } else {
      box.classList.add("hidden");
    }
  }

  /* ---------- เลือกรูป ---------- */
  var fileCamera = $("#file-camera"), fileUpload = $("#file-upload");
  $("#btn-camera").addEventListener("click", function () { fileCamera.click(); });
  $("#btn-upload").addEventListener("click", function () { fileUpload.click(); });
  $("#dropzone").addEventListener("click", function () { fileUpload.click(); });
  $("#dropzone").addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileUpload.click(); }
  });
  [fileCamera, fileUpload].forEach(function (inp) {
    inp.addEventListener("change", function () {
      if (inp.files && inp.files[0]) handleFile(inp.files[0]);
      inp.value = "";
    });
  });
  var dz = $("#dropzone");
  ["dragover", "dragenter"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
  });
  dz.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  function resizeImage(img, max, quality) {
    var w = img.naturalWidth, h = img.naturalHeight, r = Math.min(1, max / Math.max(w, h));
    var c = document.createElement("canvas");
    c.width = Math.round(w * r); c.height = Math.round(h * r);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  }
  function handleFile(file) {
    if (!/^image\//.test(file.type)) { toast("กรุณาเลือกไฟล์รูปภาพ"); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var dataUrl = resizeImage(img, 1024, 0.85);
      state.image = { dataUrl: dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg", thumb: resizeImage(img, 160, 0.7) };
      $("#preview").src = dataUrl;
      $("#preview").classList.remove("hidden");
      $("#drop-empty").classList.add("hidden");
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { toast("เปิดรูปนี้ไม่ได้ ลองรูปอื่น"); };
    img.src = url;
  }

  $$("#view-analyze .chips").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip", group).forEach(function (c) { c.classList.remove("selected"); });
      chip.classList.add("selected");
      if (group.dataset.group === "water") state.water = parseInt(chip.dataset.value, 10);
      else state.light = chip.dataset.value;
    });
  });

  /* ---------- วิเคราะห์ด้วย AI ---------- */
  $("#btn-analyze").addEventListener("click", function () {
    if (!state.image) { toast("เพิ่มรูปต้นไม้ก่อนนะ"); return; }
    $("#loading").classList.remove("hidden");
    api("/api/analyze", "POST", {
      image: state.image.base64, mediaType: state.image.mediaType, water: state.water, light: state.light
    }).then(function (d) {
      state.lastResult = d.result;
      renderResult(d.result);
      go("result");
    }).catch(function (err) {
      if (!session.user) return;
      $("#result-body").innerHTML =
        '<div class="err-box"><b>วิเคราะห์ไม่สำเร็จ</b><p>' + esc(err.message) + "</p></div>" +
        '<button class="btn btn-outline" data-goto="analyze" style="margin-top:12px">ลองอีกครั้ง</button>';
      go("result");
    }).then(function () { $("#loading").classList.add("hidden"); });
  });

  var ICONS = PC_DATA.icons;
  function card(cls, icon, title, text) {
    return '<div class="res-card ' + cls + '"><div class="ic">' + icon + "</div><div><b>" + esc(title) + "</b><small>" + esc(text) + "</small></div></div>";
  }
  function healthMeta(h) {
    if (h === "healthy") return { cls: "res-green", icon: ICONS.leaf };
    if (h === "critical") return { cls: "res-red", icon: ICONS.warn };
    return { cls: "res-yellow", icon: ICONS.warn };
  }
  function issueName(i) { return typeof i === "string" ? i : (i && i.name) || ""; }

  function renderResult(r) {
    var hm = healthMeta(r.health), html = "";
    if (state.image) html += '<img class="res-photo" src="' + state.image.dataUrl + '" alt="รูปที่วิเคราะห์">';
    html += card("res-green", ICONS.leaf, r.plant_name || "ไม่ทราบชนิด", "ความมั่นใจ " + (Number(r.confidence) || 0) + "%");
    html += card(hm.cls, hm.icon, r.health_title || "สภาพต้นไม้", r.health_detail || "");
    if (r.reasoning) {
      html += '<div class="why"><b>AI ดูอะไรจากรูปนี้</b>' + esc(r.reasoning) + "</div>";
    }
    if (r.issues && r.issues.length) {
      html += '<div class="sec-title">ความผิดปกติที่พบ</div>';
      html += r.issues.map(function (i) {
        if (typeof i === "string") return '<div class="issue"><b>' + esc(i) + "</b></div>";
        return '<div class="issue"><b>' + esc(i.name) + "</b>" +
          (i.cause ? "<p>สาเหตุที่เป็นไปได้: " + esc(i.cause) + "</p>" : "") +
          (i.fix ? "<p>วิธีแก้: " + esc(i.fix) + "</p>" : "") + "</div>";
      }).join("");
    }
    html += '<div class="sec-title">คำแนะนำการดูแล</div>';
    html += card("res-white", ICONS.drop, "ตรวจสอบการให้น้ำ", r.watering || "-");
    html += card("res-white", ICONS.sun, "ปรับแสงแดด", r.light || "-");
    html += card("res-white", ICONS.bag, "ดินและปุ๋ย", r.fertilizer || "-");
    if (r.tips && r.tips.length) {
      html += '<div class="sec-title">ป้องกันต้นไม้เสียหาย</div><ul class="tips">' +
        r.tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
    }
    if (r.note) html += '<p class="note-ai">หมายเหตุจาก AI: ' + esc(r.note) + "</p>";
    html += '<p class="note-ai">ผลนี้เป็นการประเมินจากรูปภาพ ไม่ใช่การวินิจฉัยของผู้เชี่ยวชาญ หากอาการรุนแรงควรปรึกษาร้านพันธุ์ไม้หรือเกษตรในพื้นที่</p>';
    html += '<button class="btn btn-primary" id="btn-save-plant" style="margin-top:12px">บันทึกต้นไม้ และเตือนรดน้ำ</button>';
    html += '<button class="btn btn-outline" id="btn-ask-ai">ถามผู้ช่วยเพิ่มเติม</button>';
    $("#result-body").innerHTML = html;
  }

  $("#result-body").addEventListener("click", function (e) {
    if (e.target.closest("#btn-save-plant")) savePlant();
    if (e.target.closest("#btn-ask-ai")) {
      var r = state.lastResult || {};
      chatContext = (r.plant_name || "") + " | " + (r.health_title || "") + " | " + (r.issues || []).map(issueName).join(", ");
      state.chat = []; go("chat");
    }
  });

  /* ---------- บันทึกต้นไม้ ---------- */
  function savePlant() {
    var r = state.lastResult;
    if (!r || r.plant_name === "ไม่พบต้นไม้") { toast("ไม่พบต้นไม้ในรูป ลองถ่ายใหม่"); return; }
    var every = parseInt(r.water_every_days, 10);
    if (!every || every < 1 || every > 60) every = state.water;
    plants.unshift({
      id: "p" + Date.now(),
      name: r.plant_name || "ต้นไม้ของฉัน",
      thumb: state.image ? state.image.thumb : "",
      health: r.health || "attention",
      healthTitle: r.health_title || "",
      light: state.light,
      every: every,
      lastWater: Date.now(),
      nextWater: Date.now() + every * DAY,
      watering: r.watering, lightTip: r.light, fertilizer: r.fertilizer,
      issues: (r.issues || []).map(issueName), tips: r.tips || [],
      added: Date.now()
    });
    savePlants();
    toast("บันทึกแล้ว จะเตือนรดน้ำทุก " + every + " วัน");
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    go("plants");
  }

  /* ---------- ต้นไม้ของฉัน ---------- */
  function dueText(p) {
    var diff = p.nextWater - Date.now();
    if (diff <= 0) return { t: "ถึงเวลารดน้ำแล้ว", due: true };
    var d = Math.ceil(diff / DAY);
    return { t: d <= 1 ? "รดน้ำพรุ่งนี้" : "รดน้ำอีก " + d + " วัน", due: false };
  }
  function pillFor(h) {
    var L = PC_DATA.healthLabels;
    return L[h] || L.attention;
  }
  function renderPlants() {
    var box = $("#plant-list");
    if (!plants.length) {
      box.innerHTML = '<div class="empty"><p>ยังไม่มีต้นไม้</p><button class="btn btn-primary" data-goto="analyze">วิเคราะห์ต้นไม้ต้นแรก</button></div>';
      return;
    }
    box.innerHTML = plants.map(function (p) {
      var pill = pillFor(p.health), d = dueText(p);
      return '<div class="plant" data-id="' + esc(p.id) + '"><div class="plant-head">' +
        (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<img alt="">') +
        "<div><b>" + esc(p.name) + '</b><span class="pill ' + pill[0] + '">' + pill[1] + "</span> " +
        '<span class="pill ' + (d.due ? "due" : "ok") + '">' + d.t + "</span></div></div>" +
        '<div class="plant-meta">แสง: ' + esc(p.light) + " • รดน้ำทุก " + esc(p.every) + " วัน</div>" +
        '<div class="plant-actions">' +
        '<button class="btn btn-primary" data-act="water">รดน้ำแล้ว</button>' +
        '<button class="btn btn-outline" data-act="ask">ถาม AI</button>' +
        '<button class="btn btn-outline" data-act="del">ลบ</button></div>' +
        "<details><summary>ดูคำแนะนำการดูแล</summary>" +
        "<p><b>น้ำ:</b> " + esc(p.watering || "-") + "<br><b>แสง:</b> " + esc(p.lightTip || "-") + "<br><b>ปุ๋ย:</b> " + esc(p.fertilizer || "-") + "</p>" +
        (p.issues && p.issues.length ? "<p><b>ความผิดปกติ:</b> " + esc(p.issues.join(", ")) + "</p>" : "") +
        "</details></div>";
    }).join("");
  }
  $("#plant-list").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var id = btn.closest(".plant").dataset.id;
    var idx = plants.findIndex(function (p) { return p.id === id; });
    if (idx < 0) return;
    var p = plants[idx];
    if (btn.dataset.act === "water") {
      p.lastWater = Date.now(); p.nextWater = Date.now() + p.every * DAY; p.notifiedOn = null;
      savePlants(); toast("บันทึกการรดน้ำแล้ว"); renderPlants(); renderHome();
    } else if (btn.dataset.act === "del") {
      if (confirm("ลบ " + p.name + " ?")) { plants.splice(idx, 1); savePlants(); renderPlants(); renderHome(); }
    } else if (btn.dataset.act === "ask") {
      chatContext = p.name + " | " + (p.healthTitle || "") + " | รดน้ำทุก " + p.every + " วัน แสง" + p.light;
      state.chat = []; go("chat");
    }
  });

  /* ---------- แจ้งเตือน ---------- */
  function checkReminders() {
    $("#tab-badge").classList.toggle("hidden", duePlants().length === 0);
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var today = new Date().toDateString(), changed = false;
    plants.forEach(function (p) {
      if (p.nextWater <= Date.now() && p.notifiedOn !== today) {
        try { new Notification("PlantCare AI", { body: "ถึงเวลารดน้ำ " + p.name + " แล้ว" }); } catch (e) { /* ignore */ }
        p.notifiedOn = today; changed = true;
      }
    });
    if (changed) savePlants();
  }
  setInterval(function () { if (session.user) checkReminders(); }, 60000);

  /* ---------- แชตกับผู้ช่วย AI ---------- */
  var TOPICS = PC_DATA.chatTopics;
  var STYLES = PC_DATA.answerStyles;
  var chatBusy = false;

  function findTopic(id) { return TOPICS.filter(function (t) { return t.id === id; })[0]; }

  function initChat() {
    if (!state.chat.length) {
      $("#chat-log").innerHTML = "";
      addMsg("bot", (chatContext
        ? "สวัสดี ต้องการถามอะไรเกี่ยวกับต้นไม้ต้นนี้ไหม (" + chatContext.split(" | ")[0] + ")"
        : "สวัสดี ฉันคือผู้ช่วยปลูกต้นไม้ ถามได้เลยเรื่องการรดน้ำ แสง ปุ๋ย หรือโรคของพืช") +
        "\n\nเลือกหมวดด้านล่างเพื่อดูคำถามยอดนิยม แต่ละคำตอบเลือกดูได้ทั้งแบบสั้น ละเอียด หรือเป็นขั้นตอน หรือพิมพ์ถามเองก็ได้");
    }
    renderQuick(null);
  }

  // แถบคำถามลัด: หมวดหมู่ -> คำถามในหมวด
  function renderQuick(topicId) {
    var html;
    if (!topicId) {
      html = TOPICS.map(function (t) {
        return '<button type="button" data-topic="' + t.id + '">' + t.icon + " " + esc(t.label) + "</button>";
      }).join("");
    } else {
      var t = findTopic(topicId);
      html = '<button type="button" class="back" data-topic="">← หมวดหมู่</button>' +
        t.items.map(function (it, i) {
          return '<button type="button" data-topic="' + t.id + '" data-i="' + i + '">' + esc(it.q) + "</button>";
        }).join("");
    }
    $("#quick").innerHTML = html;
  }
  $("#quick").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || chatBusy) return;
    if (b.dataset.i !== undefined) askBuiltin(b.dataset.topic, parseInt(b.dataset.i, 10), "short", true);
    else renderQuick(b.dataset.topic || null);
  });

  function addMsg(who, text) {
    var d = document.createElement("div");
    d.className = "msg " + who; d.textContent = text;
    var log = $("#chat-log");
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  }
  function clearActions() { $$(".msg-actions").forEach(function (n) { n.remove(); }); }
  function addActions(defs) {
    var box = document.createElement("div");
    box.className = "msg-actions";
    defs.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = d.label;
      b.addEventListener("click", function () { if (!chatBusy) { clearActions(); d.run(); } });
      box.appendChild(b);
    });
    var log = $("#chat-log");
    log.appendChild(box); log.scrollTop = log.scrollHeight;
  }

  // ตอบจากคำตอบสำเร็จรูป (ทันที ไม่ต้องรอ AI) พร้อมปุ่มเปลี่ยนรูปแบบคำตอบ
  function askBuiltin(topicId, i, style, showUser, userLabel) {
    clearActions();
    var t = findTopic(topicId), it = t.items[i];
    if (showUser) {
      var label = userLabel || it.q;
      addMsg("me", label);
      state.chat.push({ role: "user", content: label });
    }
    var text = it.a[style];
    addMsg("bot", text);
    state.chat.push({ role: "assistant", content: text });

    var defs = [];
    STYLES.forEach(function (s) {
      if (s.id !== style) defs.push({ label: s.label, run: function () { askBuiltin(topicId, i, s.id, true, s.label); } });
    });
    defs.push({
      label: "ถาม AI เพิ่ม",
      run: function () { sendChat("ช่วยอธิบายเพิ่มเติมเรื่อง \"" + it.q + "\" ให้เหมาะกับต้นไม้ของฉัน พร้อมเหตุผล"); }
    });
    [1, 2].forEach(function (step) {
      var j = (i + step) % t.items.length;
      if (j !== i) defs.push({ label: t.items[j].q, run: function () { askBuiltin(topicId, j, "short", true); } });
    });
    addActions(defs);
  }

  // หาคำตอบสำเร็จรูปจากคำสำคัญ ใช้ตอนติดต่อ AI ไม่ได้
  function findBuiltin(text) {
    for (var a = 0; a < TOPICS.length; a++) {
      for (var b = 0; b < TOPICS[a].items.length; b++) {
        var ks = TOPICS[a].items[b].k || [];
        for (var c = 0; c < ks.length; c++) {
          if (text.indexOf(ks[c]) >= 0) return { t: TOPICS[a].id, i: b };
        }
      }
    }
    return null;
  }

  $("#chat-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = $("#chat-input"), t = inp.value.trim();
    if (!t) return;
    inp.value = "";
    sendChat(t);
  });

  function sendChat(text) {
    if (chatBusy) return;
    chatBusy = true; clearActions();
    addMsg("me", text);
    state.chat.push({ role: "user", content: text });
    var wait = addMsg("bot", "กำลังคิด...");
    api("/api/chat", "POST", { messages: state.chat, context: chatContext || "" }).then(function (d) {
      wait.textContent = d.reply;
      state.chat.push({ role: "assistant", content: d.reply });
      $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
      chatBusy = false;
      addActions(PC_DATA.aiFollowUps.map(function (f) {
        return { label: f.label, run: function () { sendChat(f.prompt); } };
      }));
    }).catch(function (err) {
      var hit = findBuiltin(text);
      if (hit) {
        wait.textContent = "ตอนนี้ติดต่อ AI ไม่ได้ (" + err.message + ") จึงตอบจากคำตอบสำเร็จรูปให้แทน";
        chatBusy = false;
        askBuiltin(hit.t, hit.i, "short", false);
      } else {
        state.chat.pop();
        wait.textContent = "ตอบไม่ได้: " + err.message;
      }
    }).then(function () { chatBusy = false; });
  }

  /* ---------- บัญชีและตั้งค่า ---------- */
  $("#btn-settings").addEventListener("click", function () {
    $("#acct-name").textContent = session.user ? session.user.name : "-";
    $("#acct-email").textContent = session.user ? session.user.email : "-";
    $("#modal").classList.remove("hidden");
  });
  $("#btn-close-settings").addEventListener("click", function () { $("#modal").classList.add("hidden"); });
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
  $("#btn-logout").addEventListener("click", function () { logout(false); });
  $("#btn-notify").addEventListener("click", function () {
    if (!("Notification" in window)) { toast("เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน"); return; }
    Notification.requestPermission().then(function (p) {
      toast(p === "granted" ? "เปิดการแจ้งเตือนแล้ว" : "ยังไม่ได้อนุญาตการแจ้งเตือน");
    });
  });
  $("#btn-clear-data").addEventListener("click", function () {
    if (confirm("ลบต้นไม้ทั้งหมดในบัญชีนี้?")) {
      plants = []; savePlants();
      $("#modal").classList.add("hidden"); renderHome(); toast("ลบข้อมูลแล้ว");
    }
  });

  boot();
})();