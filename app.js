/* PlantCare AI — logic ทั้งหมดของแอป */
(function () {
  "use strict";

  /* ---------- ค่าคงที่และ state ---------- */
  var API_URL = "https://api.anthropic.com/v1/messages";
  var DEFAULT_MODEL = "claude-sonnet-5-5";
  var DAY = 86400000;

  var state = {
    image: null,        // { dataUrl, base64, mediaType }
    water: 3,           // ความถี่รดน้ำ (วัน)
    light: "ในร่ม",
    lastResult: null,
    chat: []            // ประวัติแชต
  };

  /* ---------- helper ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast("พื้นที่เก็บข้อมูลเต็ม ลบต้นไม้เก่าบางต้นก่อน"); return false; }
  }
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  var plants = load("pc_plants", []);
  var settings = load("pc_settings", { apiKey: "", model: DEFAULT_MODEL });

  /* ---------- การนำทาง ---------- */
  function go(name) {
    $$(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); });
    var tabName = name === "result" ? "analyze" : name;
    $$(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.goto === tabName); });
    var v = $("#view-" + name);
    if (v) v.scrollTop = 0;
    if (name === "home") renderHome();
    if (name === "plants") renderPlants();
    if (name === "analyze") updateModeHint();
    if (name === "chat") initChat();
  }
  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-goto]");
    if (el) go(el.dataset.goto);
  });

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

  /* ---------- หน้าวิเคราะห์: เลือกรูป ---------- */
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
      state.image = {
        dataUrl: dataUrl,
        base64: dataUrl.split(",")[1],
        mediaType: "image/jpeg",
        thumb: resizeImage(img, 160, 0.7)
      };
      $("#preview").src = dataUrl;
      $("#preview").classList.remove("hidden");
      $("#drop-empty").classList.add("hidden");
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { toast("เปิดรูปนี้ไม่ได้ ลองรูปอื่น"); };
    img.src = url;
  }

  /* ---------- ตัวเลือก chip ---------- */
  $$(".chips").forEach(function (group) {
    group.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      $$(".chip", group).forEach(function (c) { c.classList.remove("selected"); });
      chip.classList.add("selected");
      if (group.dataset.group === "water") state.water = parseInt(chip.dataset.value, 10);
      else state.light = chip.dataset.value;
    });
  });

  function updateModeHint() {
    $("#mode-hint").textContent = settings.apiKey
      ? ""
      : "โหมดตัวอย่าง: ยังไม่ได้ใส่ API Key (ตั้งค่าได้ที่หน้าแรก)";
  }

  /* ---------- เรียก AI ---------- */
  var SYSTEM_PROMPT =
    "คุณคือ PlantCare AI ผู้เชี่ยวชาญด้านพืชและการดูแลต้นไม้ ตอบเป็นภาษาไทยที่เข้าใจง่ายสำหรับมือใหม่ " +
    "วิเคราะห์สุขภาพต้นไม้จากรูป ระบุความผิดปกติของใบ (เช่น ใบเหลือง จุด รา แมลง ปลายไหม้) " +
    "และแนะนำวิธีดูแลให้เหมาะกับชนิดต้นไม้และสภาพแวดล้อมที่ผู้ใช้ให้มา";

  function waterLabel(d) { return d === 1 ? "ทุกวัน" : d === 3 ? "ทุก 2-3 วัน" : "สัปดาห์ละครั้ง"; }

  function callClaude(messages, system, maxTokens) {
    if (!settings.apiKey) return Promise.reject(new Error("NO_KEY"));
    return fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: settings.model || DEFAULT_MODEL,
        max_tokens: maxTokens || 1500,
        system: system,
        messages: messages
      })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || ("HTTP " + res.status);
          throw new Error(msg);
        }
        return data.content.map(function (b) { return b.type === "text" ? b.text : ""; }).join("");
      });
    });
  }

  function parseJSON(text) {
    var s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s < 0 || e < 0) throw new Error("AI ตอบกลับในรูปแบบที่อ่านไม่ได้");
    return JSON.parse(text.slice(s, e + 1));
  }

  function analyzePlant() {
    var prompt =
      "วิเคราะห์ต้นไม้ในรูปนี้ ข้อมูลจากผู้ใช้: รดน้ำ" + waterLabel(state.water) + ", แสง" + state.light + ".\n" +
      "ตอบเป็น JSON อย่างเดียว ไม่มีข้อความอื่น ตามโครงสร้างนี้:\n" +
      '{"plant_name":"ชื่อไทย (ชื่อวิทยาศาสตร์)","confidence":0-100,' +
      '"health":"healthy|attention|critical","health_title":"สรุปสภาพสั้นๆ","health_detail":"รายละเอียด 1-2 ประโยค",' +
      '"issues":["ความผิดปกติที่พบ"],' +
      '"watering":"คำแนะนำการรดน้ำ","light":"คำแนะนำเรื่องแสง","fertilizer":"คำแนะนำปุ๋ย/ดิน",' +
      '"water_every_days":จำนวนวันที่ควรรดน้ำรอบถัดไป(ตัวเลข),"tips":["เคล็ดลับป้องกันต้นไม้ตาย 2-4 ข้อ"]}\n' +
      "ถ้ารูปไม่ใช่ต้นไม้ ให้ plant_name เป็น \"ไม่พบต้นไม้\" และ confidence เป็น 0";
    return callClaude([{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: state.image.mediaType, data: state.image.base64 } },
        { type: "text", text: prompt }
      ]
    }], SYSTEM_PROMPT, 1500).then(parseJSON);
  }

  function demoResult() {
    var days = state.water;
    return {
      demo: true,
      plant_name: "ต้นไม้ตัวอย่าง (Demo)",
      confidence: 90,
      health: "attention",
      health_title: "สภาพ: ต้องดูแลเพิ่มเติม",
      health_detail: "นี่คือผลตัวอย่างเพราะยังไม่ได้ใส่ API Key ใส่คีย์ในหน้าตั้งค่าเพื่อให้ AI วิเคราะห์รูปจริง",
      issues: ["ปลายใบอาจเริ่มแห้ง", "ควรตรวจใต้ใบว่ามีแมลงหรือไม่"],
      watering: "รดน้ำเมื่อดินผิวหน้าแห้ง ประมาณ " + waterLabel(days) + " และไม่ให้น้ำขัง",
      light: "แสง" + state.light + " เหมาะกับต้นไม้ส่วนใหญ่ ควรหมุนกระถางทุกสัปดาห์",
      fertilizer: "ใส่ปุ๋ยสูตรเสมอเดือนละครั้งในช่วงที่ต้นไม้โต",
      water_every_days: days,
      tips: ["เช็กความชื้นดินด้วยนิ้วก่อนรดน้ำ", "ตัดใบเหลืองหรือใบเสียออก", "อย่าวางกระถางในจุดที่ลมแรง"]
    };
  }

  $("#btn-analyze").addEventListener("click", function () {
    if (!state.image) { toast("เพิ่มรูปต้นไม้ก่อนนะ"); return; }
    $("#loading").classList.remove("hidden");
    var p = settings.apiKey ? analyzePlant() : new Promise(function (r) { setTimeout(function () { r(demoResult()); }, 900); });
    p.then(function (result) {
      state.lastResult = result;
      renderResult(result);
      go("result");
    }).catch(function (err) {
      $("#result-body").innerHTML =
        '<div class="err-box"><b>วิเคราะห์ไม่สำเร็จ</b><p>' + esc(friendlyError(err)) + "</p></div>" +
        '<button class="btn btn-outline" data-goto="analyze" style="margin-top:12px">ลองอีกครั้ง</button>';
      go("result");
    }).then(function () {
      $("#loading").classList.add("hidden");
    });
  });

  function friendlyError(err) {
    var m = String(err && err.message || err);
    if (/401|invalid x-api-key|authentication/i.test(m)) return "API Key ไม่ถูกต้อง ตรวจสอบในหน้าตั้งค่า";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่";
    if (/429|rate/i.test(m)) return "ใช้งานถี่เกินไป รอสักครู่แล้วลองใหม่";
    return m;
  }

  /* ---------- แสดงผลการวิเคราะห์ ---------- */
  var ICONS = {
    leaf: '<svg viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 16-9 0 12-4 16-9 16Z"/><path d="M4 20c2-5 5-8 9-10"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 18h.01"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M5 9h14l-1 11H6Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
  };
  function card(cls, icon, title, text) {
    return '<div class="res-card ' + cls + '"><div class="ic">' + icon + "</div><div><b>" + esc(title) + "</b><small>" + esc(text) + "</small></div></div>";
  }

  function healthMeta(h) {
    if (h === "healthy") return { cls: "res-green", icon: ICONS.leaf };
    if (h === "critical") return { cls: "res-red", icon: ICONS.warn };
    return { cls: "res-yellow", icon: ICONS.warn };
  }

  function renderResult(r) {
    var hm = healthMeta(r.health);
    var html = "";
    if (r.demo) html += '<span class="demo-badge">ผลตัวอย่าง (ไม่ได้ใช้ AI จริง)</span>';
    if (state.image) html += '<img class="res-photo" src="' + state.image.dataUrl + '" alt="รูปที่วิเคราะห์">';
    html += card("res-green", ICONS.leaf, r.plant_name || "ไม่ทราบชนิด", "ความมั่นใจ " + (Number(r.confidence) || 0) + "%");
    html += card(hm.cls, hm.icon, r.health_title || "สภาพต้นไม้", r.health_detail || "");
    if (r.issues && r.issues.length) {
      html += card("res-white", ICONS.eye, "ความผิดปกติที่พบ", r.issues.join(" • "));
    }
    html += '<div class="sec-title">คำแนะนำการดูแล</div>';
    html += card("res-white", ICONS.drop, "ตรวจสอบการให้น้ำ", r.watering || "-");
    html += card("res-white", ICONS.sun, "ปรับแสงแดด", r.light || "-");
    html += card("res-white", ICONS.bag, "ดินและปุ๋ย", r.fertilizer || "-");
    if (r.tips && r.tips.length) {
      html += '<div class="sec-title">ป้องกันต้นไม้เสียหาย</div><ul class="tips">' +
        r.tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
    }
    html += '<button class="btn btn-primary" id="btn-save-plant" style="margin-top:16px">บันทึกต้นไม้ และเตือนรดน้ำ</button>';
    html += '<button class="btn btn-outline" id="btn-ask-ai">ถามผู้ช่วยเพิ่มเติม</button>';
    $("#result-body").innerHTML = html;
  }

  $("#result-body").addEventListener("click", function (e) {
    if (e.target.closest("#btn-save-plant")) savePlant();
    if (e.target.closest("#btn-ask-ai")) { chatContext = state.lastResult; state.chat = []; go("chat"); }
  });

  /* ---------- บันทึกต้นไม้ ---------- */
  function savePlant() {
    var r = state.lastResult;
    if (!r) return;
    var every = parseInt(r.water_every_days, 10);
    if (!every || every < 1 || every > 60) every = state.water;
    var plant = {
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
      issues: r.issues || [], tips: r.tips || [],
      added: Date.now()
    };
    plants.unshift(plant);
    if (save("pc_plants", plants)) {
      toast("บันทึกแล้ว จะเตือนรดน้ำทุก " + every + " วัน");
      askNotificationPermission();
      go("plants");
    } else {
      plants.shift();
    }
  }

  /* ---------- หน้าต้นไม้ของฉัน ---------- */
  function dueText(p) {
    var diff = p.nextWater - Date.now();
    if (diff <= 0) return { t: "ถึงเวลารดน้ำแล้ว", due: true };
    var d = Math.ceil(diff / DAY);
    return { t: d <= 1 ? "รดน้ำพรุ่งนี้" : "รดน้ำอีก " + d + " วัน", due: false };
  }
  function pillFor(h) {
    return h === "healthy" ? ["ok", "สุขภาพดี"] : h === "critical" ? ["bad", "ต้องรีบดูแล"] : ["warn", "ควรดูแลเพิ่ม"];
  }

  function renderPlants() {
    var box = $("#plant-list");
    if (!plants.length) {
      box.innerHTML = '<div class="empty"><p>ยังไม่มีต้นไม้</p><button class="btn btn-primary" data-goto="analyze">วิเคราะห์ต้นไม้ต้นแรก</button></div>';
      return;
    }
    box.innerHTML = plants.map(function (p) {
      var pill = pillFor(p.health), d = dueText(p);
      return '<div class="plant" data-id="' + esc(p.id) + '">' +
        '<div class="plant-head">' +
        (p.thumb ? '<img src="' + p.thumb + '" alt="">' : '<img alt="">') +
        "<div><b>" + esc(p.name) + '</b><span class="pill ' + pill[0] + '">' + pill[1] + "</span> " +
        '<span class="pill ' + (d.due ? "due" : "ok") + '">' + d.t + "</span></div></div>" +
        '<div class="plant-meta">แสง: ' + esc(p.light) + " • รดน้ำทุก " + p.every + " วัน</div>" +
        '<div class="plant-actions">' +
        '<button class="btn btn-primary" data-act="water">รดน้ำแล้ว</button>' +
        '<button class="btn btn-outline" data-act="ask">ถาม AI</button>' +
        '<button class="btn btn-outline" data-act="del" aria-label="ลบ">ลบ</button></div>' +
        "<details><summary>ดูคำแนะนำการดูแล</summary>" +
        "<p><b>น้ำ:</b> " + esc(p.watering || "-") + "<br><b>แสง:</b> " + esc(p.lightTip || "-") + "<br><b>ปุ๋ย:</b> " + esc(p.fertilizer || "-") + "</p>" +
        (p.issues.length ? "<p><b>ความผิดปกติ:</b> " + esc(p.issues.join(", ")) + "</p>" : "") +
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
      p.lastWater = Date.now();
      p.nextWater = Date.now() + p.every * DAY;
      p.notifiedOn = null;
      save("pc_plants", plants);
      toast("บันทึกการรดน้ำแล้ว");
      renderPlants(); renderHome();
    } else if (btn.dataset.act === "del") {
      if (confirm("ลบ " + p.name + " ?")) {
        plants.splice(idx, 1);
        save("pc_plants", plants);
        renderPlants(); renderHome();
      }
    } else if (btn.dataset.act === "ask") {
      chatContext = p; state.chat = []; go("chat");
    }
  });

  /* ---------- แจ้งเตือน ---------- */
  function askNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }
  function checkReminders() {
    renderHomeBadgeOnly();
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    var today = new Date().toDateString(), changed = false;
    plants.forEach(function (p) {
      if (p.nextWater <= Date.now() && p.notifiedOn !== today) {
        try { new Notification("PlantCare AI", { body: "ถึงเวลารดน้ำ " + p.name + " แล้ว" }); } catch (e) { /* ignore */ }
        p.notifiedOn = today; changed = true;
      }
    });
    if (changed) save("pc_plants", plants);
  }
  function renderHomeBadgeOnly() {
    $("#tab-badge").classList.toggle("hidden", duePlants().length === 0);
  }
  setInterval(checkReminders, 60000);

  /* ---------- แชตกับผู้ช่วย AI ---------- */
  var chatContext = null;
  var QUICK = ["ใบเหลืองเกิดจากอะไร", "รดน้ำบ่อยแค่ไหนดี", "ต้นไม้มือใหม่ที่ปลูกง่าย", "จัดการแมลงยังไง"];

  function initChat() {
    var log = $("#chat-log");
    if (!state.chat.length) {
      log.innerHTML = "";
      var hello = chatContext && chatContext.plant_name || chatContext && chatContext.name
        ? "สวัสดี ต้องการถามอะไรเกี่ยวกับ " + (chatContext.plant_name || chatContext.name) + " ไหม"
        : "สวัสดี ฉันคือผู้ช่วยปลูกต้นไม้ ถามได้เลยเรื่องการรดน้ำ แสง ปุ๋ย หรือโรคของพืช";
      addMsg("bot", hello);
    }
    $("#quick").innerHTML = QUICK.map(function (q) { return "<button type='button'>" + esc(q) + "</button>"; }).join("");
  }
  function addMsg(who, text) {
    var d = document.createElement("div");
    d.className = "msg " + who;
    d.textContent = text;
    var log = $("#chat-log");
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  $("#quick").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) sendChat(b.textContent);
  });
  $("#chat-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = $("#chat-input");
    var t = inp.value.trim();
    if (!t) return;
    inp.value = "";
    sendChat(t);
  });

  function sendChat(text) {
    addMsg("me", text);
    state.chat.push({ role: "user", content: text });
    var wait = addMsg("bot", "กำลังคิด...");
    if (!settings.apiKey) {
      setTimeout(function () {
        wait.textContent = "โหมดตัวอย่าง: ใส่ API Key ในหน้าตั้งค่าเพื่อให้ผู้ช่วยตอบคำถามจริง\n\nเคล็ดลับทั่วไป: เช็กดินด้วยนิ้ว ถ้าผิวดินแห้งลึก 2-3 ซม. จึงค่อยรดน้ำ และให้กระถางระบายน้ำได้ดี";
        state.chat.push({ role: "assistant", content: wait.textContent });
      }, 600);
      return;
    }
    var sys = SYSTEM_PROMPT + " ตอบสั้น กระชับ เป็นข้อๆ ถ้าจำเป็น";
    if (chatContext) {
      sys += " ต้นไม้ที่ผู้ใช้กำลังพูดถึง: " + (chatContext.plant_name || chatContext.name) +
        " สภาพ: " + (chatContext.health_title || chatContext.healthTitle || "-") + ".";
    }
    callClaude(state.chat.slice(-12), sys, 700).then(function (reply) {
      wait.textContent = reply;
      state.chat.push({ role: "assistant", content: reply });
      $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
    }).catch(function (err) {
      wait.textContent = "ตอบไม่ได้: " + friendlyError(err);
      state.chat.pop();
    });
  }

  /* ---------- ตั้งค่า ---------- */
  $("#btn-settings").addEventListener("click", function () {
    $("#api-key").value = settings.apiKey || "";
    $("#api-model").value = settings.model || DEFAULT_MODEL;
    $("#modal").classList.remove("hidden");
  });
  $("#btn-close-settings").addEventListener("click", function () { $("#modal").classList.add("hidden"); });
  $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") $("#modal").classList.add("hidden"); });
  $("#btn-save-settings").addEventListener("click", function () {
    settings = { apiKey: $("#api-key").value.trim(), model: $("#api-model").value.trim() || DEFAULT_MODEL };
    save("pc_settings", settings);
    $("#modal").classList.add("hidden");
    toast(settings.apiKey ? "บันทึกการตั้งค่าแล้ว" : "ใช้โหมดตัวอย่าง");
    updateModeHint();
  });
  $("#btn-clear-data").addEventListener("click", function () {
    if (confirm("ลบข้อมูลต้นไม้ทั้งหมด?")) {
      plants = []; save("pc_plants", plants);
      $("#modal").classList.add("hidden");
      renderHome();
      toast("ลบข้อมูลแล้ว");
    }
  });

  /* ---------- เริ่มต้น ---------- */
  renderHome();
  updateModeHint();
  checkReminders();
})();