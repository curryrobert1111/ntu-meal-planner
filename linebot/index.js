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
 *   60 或 60元             → 找今天 NT$60 左右的餐點
 *   設定                   → 看目前條件
 *   說明                   → 指令列表
 *
 * 使用者設定存在記憶體（重新部署會清空）；要長期保存可改用 Firestore、Redis 等。
 */
require("dotenv").config();
const express = require("express");
const line = require("@line/bot-sdk");
const FOODS = require("../js/data.js");
const P = require("../js/planner.js");

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
  "・60元：找今天 60 元左右的餐點",
  "・設定：看目前條件",
].join("\n");

const quickReply = {
  items: ["菜單", "60元", "全素", "穆斯林友善", "不吃 牛肉", "設定"].map(t => ({
    type: "action", action: { type: "message", label: t, text: t },
  })),
};

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

/* ---------- 指令處理 ---------- */
function handleText(uid, raw) {
  const text = raw.trim().replace(/\s+/g, " ");
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
    return P.planToText(plan) + (WEB_URL ? `\n\n完整表格：${WEB_URL}` : "");
  }

  if ((m = text.match(/^\$?(\d{2,3})\s*(元|塊)?$/))) {
    const target = Number(m[1]);
    const hits = P.findByPrice(FOODS, target, p, { tol: 15, dow: new Date().getDay(), limit: 8 });
    if (!hits.length) return `今天 $${target} 左右找不到符合條件的餐點，試試別的金額。`;
    return `今天 $${target} 左右：\n` + hits.map(h => {
      const f = h.parts[0];
      return `・${f.item}｜${f.store} $${h.price}${h.flags.length ? "（" + h.flags.join("、") + "）" : ""}`;
    }).join("\n");
  }

  return "看不懂這個指令 🙏\n\n" + HELP;
}

async function handleEvent(event) {
  if (event.type === "follow") {
    return client.replyMessage({ replyToken: event.replyToken, messages: [{ type: "text", text: HELP, quickReply }] });
  }
  if (event.type !== "message" || event.message.type !== "text") return null;
  const uid = (event.source && event.source.userId) || "anon";
  const reply = handleText(uid, event.message.text);
  const messages = chunk(reply).map(t => ({ type: "text", text: t }));
  messages[messages.length - 1].quickReply = quickReply;
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

const port = process.env.PORT || 3000;
if (require.main === module) app.listen(port, () => console.log(`LINE bot listening on :${port}`));
module.exports = { handleText };
