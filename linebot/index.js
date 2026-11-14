/*
 * 台大平價餐點 LINE Bot
 * 與網頁共用 ../js/data.js（餐點資料）與 ../js/planner.js（排餐邏輯）。
 *
 * 指令（直接傳文字給 Bot）：
 *   菜單 / 排菜單           → 排一週三餐
 *   預算 1500              → 設定一週預算
 *   加點 3                 → 一週加幾次飲料／點心
 *   全素 / 蛋奶素 / 鍋邊素 / 不限素食
 *   穆斯林友善 / 清真 / 取消穆斯林
 *   不吃 牛肉 花生          → 設定忌口（豬肉 牛肉 雞肉 海鮮 蛋 奶 花生）
 *   清除忌口
 *   80 / 80元              → 先問要哪一類（正餐、早餐、飲料、咖啡、點心、全部），再找今天 80 元左右的
 *   正餐 80 / 飲料 50       → 直接找某一類
 *   飲料 / 點心 / 正餐 …     → 先問要多少錢，再找
 *   設定                   → 看目前條件
 *   說明                   → 指令列表
 *
 *   其他任何句子             → 有設定 GEMINI_API_KEY 時交給 Gemini 回答（見 gemini.js、GEMINI.md）
 *
 * 使用者設定存在記憶體（重新部署會清空）；要長期保存可改用 Firestore、Redis 等。
 */
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const FOODS = require("../js/data.js");
const P = require("../js/planner.js");
const { askGemini, enabled: aiEnabled } = require("./gemini");

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
if (!config.channelSecret || !config.channelAccessToken) {
  console.error("請先設定環境變數 LINE_CHANNEL_SECRET 與 LINE_CHANNEL_ACCESS_TOKEN（見 .env.example）");
  process.exit(1);
}
const client = new line.messagingApi.MessagingApiClient({ channelAccessToken: config.channelAccessToken });
const WEB_URL = process.env.WEB_URL || ""; // 例如 https://你的帳號.github.io/ntu-meal-planner/

/* ---------- 使用者設定 ---------- */
const profiles = new Map();
const getProfile = uid => {
  if (!profiles.has(uid)) profiles.set(uid, P.defaultProfile());
  return profiles.get(uid);
};
const TAG_BY_NAME = Object.fromEntries(Object.entries(P.TAGS).map(([k, v]) => [v, k]));
TAG_BY_NAME["豬"] = "pork"; TAG_BY_NAME["牛"] = "beef"; TAG_BY_NAME["雞"] = "chicken";
TAG_BY_NAME["蛋類"] = "egg"; TAG_BY_NAME["奶類"] = "dairy"; TAG_BY_NAME["牛奶"] = "dairy";

function describe(p) {
  return [
    `預算 $${p.budget}（預留 $${p.reserve}）`,
    `素食：${P.DIETS[p.diet]}`,
    `穆斯林：${P.MUSLIM[p.muslim]}`,
    `忌口：${p.avoid.length ? p.avoid.map(t => P.TAGS[t]).join("、") : "無"}`,
    `一週加點：${p.extras} 次`,
  ].join("\n");
}

const HELP = [
  "🍱 台大平價餐點 Bot",
  "・菜單：排一週三餐",
  "・預算 1500：設定一週預算",
  "・加點 3：一週加幾次飲料／點心",
  "・全素／蛋奶素／鍋邊素／不限素食",
  "・穆斯林友善／清真／取消穆斯林",
  "・不吃 牛肉 花生；清除忌口",
  "・80：找今天 80 元左右的餐點（會先問你要哪一類）",
  "・正餐 80／早餐 50／飲料 50／點心 40／咖啡 80：直接找某一類",
  "・設定：看目前條件",
  "・也可以直接用一句話問，例如「公館有什麼便宜的拉麵」",
].join("\n");

const quickReply = {
  items: ["菜單", "正餐", "飲料", "點心", "80", "全素", "不吃 牛肉", "設定"].map(t => ({
    type: "action", action: { type: "message", label: t, text: t },
  })),
};

/** 每則回覆可以帶自己的快速按鈕；沒指定就用預設那組 */
const qr = labels => ({ items: labels.slice(0, 13).map(([label, text]) => ({ type: "action", action: { type: "message", label: label.slice(0, 20), text: text || label } })) });
const reply = (text, buttons) => ({ text, buttons });

/** 依金額找的分類 */
const CATS = {
  正餐: { label: "正餐", test: f => P.isMain(f, "午餐"), meal: "全部" },
  早餐: { label: "早餐", test: f => P.isMain(f, "早餐"), meal: "早餐" },
  午餐: { label: "午餐", test: f => P.isMain(f, "午餐"), meal: "午餐" },
  晚餐: { label: "晚餐", test: f => P.isMain(f, "晚餐"), meal: "晚餐" },
  飲料: { label: "飲料", test: f => f.kind === "飲料" || f.kind === "咖啡", meal: "全部" },
  咖啡: { label: "咖啡", test: f => f.kind === "咖啡", meal: "全部" },
  點心: { label: "點心", test: f => f.kind === "點心", meal: "全部" },
  全部: { label: "全部", test: () => true, meal: "全部" },
};
const CAT_ALIAS = { 主餐: "正餐", 吃飯: "正餐", 飯: "正餐", 喝的: "飲料", 手搖: "飲料", 手搖飲: "飲料", 茶: "飲料", 甜點: "點心", 小吃: "點心", 不限: "全部", 都可以: "全部" };
const catOf = w => (CATS[w] ? w : CAT_ALIAS[w]) || null;
const CAT_WORDS = [...Object.keys(CATS), ...Object.keys(CAT_ALIAS)].join("|");

/** 台灣時間的星期幾（伺服器在國外，不能直接用 new Date().getDay()） */
const twDow = () => new Date(Date.now() + 8 * 3600 * 1000).getUTCDay();

/** 等待使用者回答「要哪一類」或「多少錢」：{ price?, cat?, at } */
const pending = new Map();
const PENDING_MS = 10 * 60 * 1000;

function searchByPrice(p, target, catKey) {
  const cat = CATS[catKey];
  const perStore = new Map();
  // 越接近目標價越前面，但同樣接近的隨機排，每次問都能看到不同的店
  const hits = P.findByPrice(FOODS, target, p, { tol: 15, dow: twDow(), meal: cat.meal, limit: 2000 })
    .filter(h => cat.test(h.parts[0]))
    .map(h => ({ h, k: Math.abs(h.price - target) + Math.random() * 12 }))
    .sort((a, b) => a.k - b.k).map(x => x.h)
    .filter(h => { const s = h.parts[0].store; const n = perStore.get(s) || 0; perStore.set(s, n + 1); return n < 2; })
    .slice(0, 8);
  const again = [["換 " + (target - 20) + " 元", `${catKey} ${Math.max(10, target - 20)}`], ["換 " + (target + 20) + " 元", `${catKey} ${target + 20}`],
    ...Object.keys(CATS).filter(k => k !== catKey && !["午餐", "晚餐"].includes(k)).map(k => [k, `${k} ${target}`])];
  if (!hits.length) return reply(`今天 $${target} 左右找不到「${cat.label}」，試試別的金額或類別。`, again);
  return reply(`今天 $${target} 左右的「${cat.label}」：\n` + hits.map(h => {
    const f = h.parts[0];
    return `・${f.item}｜${f.store}（${f.area}）$${h.price}${h.flags.length ? "（" + h.flags.join("、") + "）" : ""}`;
  }).join("\n"), again);
}

/** LINE 單則文字上限 5000 字，最多 5 則 */
function chunk(text) {
  const out = []; let buf = "";
  for (const part of text.split("\n\n")) {
    if ((buf + "\n\n" + part).length > 4500) { out.push(buf); buf = part; }
    else buf = buf ? buf + "\n\n" + part : part;
  }
  if (buf) out.push(buf);
  return out.slice(0, 5);
}

const planLink = plan => (WEB_URL ? WEB_URL + (WEB_URL.includes("?") ? "&" : "?") + P.planToParam(plan) : "");

/* ---------- 指令處理 ---------- */
function handleText(uid, raw) {
  // 全形數字、全形 $ 轉半形（手機中文輸入法常打出「８０」）
  const text = raw.trim()
    .replace(/[０-９＄]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, " ");
  const p = getProfile(uid);
  let m;

  if (/^(說明|help|\?|？)$/i.test(text)) return HELP;
  if (/^(設定|條件)$/.test(text)) return "目前條件：\n" + describe(p);

  if ((m = text.match(/^預算\s*(\d+)/))) { p.budget = Number(m[1]); return `一週預算設為 $${p.budget}。傳「菜單」排一份。`; }
  if ((m = text.match(/^預留\s*(\d+)/))) { p.reserve = Number(m[1]); return `預留金設為 $${p.reserve}。`; }
  if ((m = text.match(/^加點\s*(\d+)/))) { p.extras = Math.min(14, Number(m[1])); return `一週加點 ${p.extras} 次。`; }

  if (text === "全素") { p.diet = "vegan"; return "已設為全素。"; }
  if (text === "蛋奶素") { p.diet = "ovo-lacto"; return "已設為蛋奶素。"; }
  if (text === "鍋邊素") { p.diet = "flex-veg"; return "已設為鍋邊素（自助餐可自選素菜）。"; }
  if (/^(不限素食|取消素食)$/.test(text)) { p.diet = "all"; return "已取消素食條件。"; }

  if (/^(穆斯林友善|穆斯林)$/.test(text)) { p.muslim = "friendly"; return "已設為穆斯林友善：排除豬肉與酒（非清真認證的店會標示）。"; }
  if (/^(清真|清真認證|halal)$/i.test(text)) { p.muslim = "halal"; return "已設為只選清真認證餐廳與素食品項。選項很少，建議同時參考台大膳委會穆斯林友善餐廳地圖。"; }
  if (/^取消穆斯林$/.test(text)) { p.muslim = "off"; return "已取消穆斯林條件。"; }

  if (/^清除忌口$/.test(text)) { p.avoid = []; return "已清除忌口。"; }
  if ((m = text.match(/^不吃\s*(.+)$/))) {
    const tags = m[1].split(/[\s,，、]+/).map(w => TAG_BY_NAME[w]).filter(Boolean);
    if (!tags.length) return "可以設定的忌口：豬肉 牛肉 雞肉 海鮮 蛋 奶 花生";
    p.avoid = [...new Set([...p.avoid, ...tags])];
    return `忌口：${p.avoid.map(t => P.TAGS[t]).join("、")}`;
  }

  if (/^(菜單|排菜單|一週菜單|排餐)$/.test(text)) {
    const plan = P.makePlan(FOODS, p);
    // 「完整表格」連結帶上這份菜單，網頁打開時會顯示同一份
    const link = planLink(plan);
    return P.planToText(plan) + (link ? `\n\n完整表格：${link}` : "");
  }

  // 依金額找：「80」「80元」「正餐 80」「80 飲料」「飲料80元」都可以
  const PRICE = "\\$?(\\d{2,3})\\s*(?:元|塊)?";
  const both = text.match(new RegExp(`^(${CAT_WORDS})\\s*${PRICE}$`)) || text.match(new RegExp(`^${PRICE}\\s*(${CAT_WORDS})$`));
  if (both) {
    const [catWord, price] = isNaN(Number(both[1])) ? [both[1], both[2]] : [both[2], both[1]];
    pending.delete(uid);
    return searchByPrice(p, Number(price), catOf(catWord));
  }
  if ((m = text.match(new RegExp(`^${PRICE}$`)))) {
    const target = Number(m[1]);
    const prev = pending.get(uid);
    if (prev && prev.cat && Date.now() - prev.at < PENDING_MS) { pending.delete(uid); return searchByPrice(p, target, prev.cat); }
    pending.set(uid, { price: target, at: Date.now() });
    return reply(`想找 $${target} 左右的哪一類？`, ["正餐", "早餐", "飲料", "咖啡", "點心", "全部"].map(k => [k, `${k} ${target}`]));
  }
  const cat = catOf(text);
  if (cat) {
    const prev = pending.get(uid);
    if (prev && prev.price && Date.now() - prev.at < PENDING_MS) { pending.delete(uid); return searchByPrice(p, prev.price, cat); }
    pending.set(uid, { cat, at: Date.now() });
    const prices = cat === "飲料" || cat === "咖啡" ? [40, 60, 80, 100] : cat === "點心" ? [30, 50, 70, 90] : cat === "早餐" ? [40, 60, 80] : [60, 80, 100, 120, 150];
    return reply(`想找多少錢左右的「${CATS[cat].label}」？點下面的金額，或直接打數字（例如 80）。`, prices.map(n => [`${n} 元`, `${cat} ${n}`]));
  }

  return null;   // 不是固定指令：交給 Gemini（沒設定金鑰時回「看不懂」）
}

async function handleEvent(event) {
  if (event.type === "follow") {
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: "text", text: HELP, quickReply }] });
  }
  if (event.type !== "message" || event.message.type !== "text") return null;
  const uid = (event.source && event.source.userId) || "anon";
  let r = handleText(uid, event.message.text);
  if (r === null) {
    const ai = await askGemini(uid, event.message.text, { FOODS, P, getProfile, describe, planLink });
    r = ai || reply("看不懂這個指令 🙏\n\n" + HELP);
  }
  const { text, buttons } = typeof r === "string" ? { text: r } : r;
  const messages = chunk(text).map(t => ({ type: "text", text: t }));
  messages[messages.length - 1].quickReply = buttons ? qr(buttons) : quickReply;
  return client.replyMessage({ replyToken: event.replyToken, messages });
}

/* ---------- 伺服器 ---------- */
const app = express();
app.get("/", (req, res) => res.send("NTU meal bot is running."));
app.post("/webhook", line.middleware({ channelSecret: config.channelSecret }), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.json({ ok: true }))
    .catch(err => { console.error(err); res.status(500).end(); });
});
app.use((err, req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) return res.status(401).send(err.signature);
  if (err instanceof line.JSONParseError) return res.status(400).send(err.raw);
  next(err);
});

const port = process.env.PORT || 3000;   // Render、Cloud Run 都會自動給 PORT
if (require.main === module) app.listen(port, () => console.log(`LINE bot listening on :${port}（AI 對話：${aiEnabled() ? "開啟" : "未設定 GEMINI_API_KEY，關閉"}）`));
module.exports = { handleText, handleEvent, getProfile, describe, planLink, FOODS, P };
