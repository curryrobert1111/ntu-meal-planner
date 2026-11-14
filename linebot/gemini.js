/*
 * gemini.js —— 用 Gemini 回答「固定指令看不懂」的自由對話
 *
 * 做法（function calling）：Gemini 只負責看懂使用者在問什麼、整理回答；
 * 店家、價格、營業時間一律由下面的工具從 ../js/data.js 查，模型不能自己編。
 *
 * 環境變數：
 *   GEMINI_API_KEY   必填，在 Google AI Studio 申請
 *   GEMINI_MODEL     選填，預設 gemini-3.5-flash-lite（舊模型下架時，改這個變數就好）
 *   AI_DAILY_LIMIT   選填，每位使用者每天最多幾則 AI 回覆，預設 30
 *   AI_GLOBAL_LIMIT  選填，整個 bot 每天最多幾則 AI 回覆，預設 1500（防止費用暴增）
 */
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = (process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
const DAILY = Number(process.env.AI_DAILY_LIMIT) || 30;
const GLOBAL = Number(process.env.AI_GLOBAL_LIMIT) || 1500;
const enabled = () => !!process.env.GEMINI_API_KEY;

const AREAS = ["校內", "水源市場", "公館", "新生南路", "118巷"];
const CATS = ["正餐", "早餐", "午餐", "晚餐", "飲料", "咖啡", "點心", "全部"];
const DIET_KEYS = { 不限: "all", 鍋邊素: "flex-veg", 蛋奶素: "ovo-lacto", 全素: "vegan" };
const MUSLIM_KEYS = { 不需要: "off", 穆斯林友善: "friendly", 清真: "halal" };
const AVOID_KEYS = { 豬肉: "pork", 牛肉: "beef", 雞肉: "chicken", 海鮮: "seafood", 蛋: "egg", 奶: "dairy", 花生: "peanut" };

/** 台灣時間 */
const twNow = () => new Date(Date.now() + 8 * 3600 * 1000);
const twDow = () => twNow().getUTCDay();
const twDate = () => twNow().toISOString().slice(0, 10);

/* ---------- 給模型用的工具 ---------- */
const TOOL_DECLS = [
  {
    name: "search_food",
    description: "從台大附近的餐點資料找符合條件、今天有營業的餐點。回答任何店家、餐點、價格的問題前都要先用這個工具。",
    parameters: {
      type: "object",
      properties: {
        price: { type: "integer", description: "目標價格（新台幣），例如 80。使用者說「便宜」可用 60，沒提價格就不要填" },
        category: { type: "string", enum: CATS, description: "正餐、早餐、午餐、晚餐、飲料、咖啡、點心或全部。沒說就用「全部」" },
        area: { type: "string", enum: AREAS, description: "區域。只有使用者明確提到地點才填" },
        keyword: { type: "string", description: "餐點或店名關鍵字，例如 牛肉麵、拉麵、豆花、50嵐" },
      },
    },
  },
  {
    name: "store_info",
    description: "查某一家店的地點、營業時間、價格範圍與部分菜單。",
    parameters: { type: "object", properties: { name: { type: "string", description: "店名或店名的一部分" } }, required: ["name"] },
  },
  {
    name: "make_week_plan",
    description: "依照使用者目前的條件排一週三餐菜單。使用者想要一週菜單、整週安排時使用。",
    parameters: { type: "object", properties: { budget: { type: "integer", description: "一週預算（新台幣），使用者有說才填" } } },
  },
  {
    name: "update_preferences",
    description: "修改使用者的條件：預算、素食、穆斯林、忌口、區域。只在使用者明確要求修改時使用。",
    parameters: {
      type: "object",
      properties: {
        budget: { type: "integer", description: "一週預算" },
        diet: { type: "string", enum: Object.keys(DIET_KEYS) },
        muslim: { type: "string", enum: Object.keys(MUSLIM_KEYS) },
        avoid_add: { type: "array", items: { type: "string", enum: Object.keys(AVOID_KEYS) }, description: "要新增的忌口" },
        avoid_clear: { type: "boolean", description: "清除所有忌口" },
        areas: { type: "array", items: { type: "string", enum: AREAS }, description: "只想吃這些區域；空陣列代表全部區域" },
      },
    },
  },
  {
    name: "get_preferences",
    description: "查看使用者目前的條件（預算、素食、穆斯林、忌口、區域）。",
    parameters: { type: "object", properties: {} },
  },
];

function makeTools({ FOODS, P, getProfile, describe, planLink }) {
  const brief = (f, flags) => ({
    store: f.store, item: f.item, price: f.price, area: f.area, place: f.place || "", hours: f.hours || "",
    note: [f.status === "check" ? "價格或營業待確認" : "", ...(flags || [])].filter(Boolean).join("、"),
  });
  const catTest = {
    正餐: f => P.isMain(f, "午餐"), 早餐: f => P.isMain(f, "早餐"), 午餐: f => P.isMain(f, "午餐"), 晚餐: f => P.isMain(f, "晚餐"),
    飲料: f => f.kind === "飲料" || f.kind === "咖啡", 咖啡: f => f.kind === "咖啡", 點心: f => f.kind === "點心", 全部: f => !f.noplan,
  };
  const mealOf = c => (["早餐", "午餐", "晚餐"].includes(c) ? c : "全部");

  return {
    search_food(uid, a) {
      const p = Object.assign({}, getProfile(uid));
      if (a.area && AREAS.includes(a.area)) p.areas = [a.area];
      const cat = CATS.includes(a.category) ? a.category : "全部";
      const kw = (a.keyword || "").trim();
      let rows;
      if (a.price) {
        rows = P.findByPrice(FOODS, Number(a.price), p, { tol: 20, dow: twDow(), meal: mealOf(cat), limit: 3000 })
          .map(h => ({ f: h.parts[0], flags: h.flags, d: Math.abs(h.price - a.price) }));
      } else {
        rows = FOODS.filter(f => !f.noplan && P.opensOn(f, twDow()) && P.check(f, p).ok && (mealOf(cat) === "全部" || (f.meals || []).includes(mealOf(cat))))
          .map(f => ({ f, flags: P.check(f, p).flags, d: 0 }));
      }
      rows = rows.filter(r => catTest[cat](r.f));
      if (kw) {   // 品名有關鍵字的優先；品名都沒有，才看店名（例如「50嵐」「拉麵店」）
        const byItem = rows.filter(r => r.f.item.includes(kw));
        rows = byItem.length ? byItem : rows.filter(r => r.f.store.includes(kw));
      }
      rows = rows
        .map(r => ({ ...r, k: r.d + Math.random() * 12 })).sort((x, y) => x.k - y.k);
      const per = new Map(), out = [];
      for (const r of rows) { const n = per.get(r.f.store) || 0; if (n < 2) { per.set(r.f.store, n + 1); out.push(brief(r.f, r.flags)); } if (out.length >= 8) break; }
      return { today: twDate(), count: out.length, results: out, hint: out.length ? "" : "沒有找到，建議換價格、類別、區域或關鍵字" };
    },
    store_info(uid, a) {
      const q = (a.name || "").trim();
      if (!q) return { found: false };
      const items = FOODS.filter(f => f.store.includes(q) || q.includes(f.store.replace(/[（(].*$/, "").trim()));
      if (!items.length) return { found: false, hint: "資料裡沒有這家店" };
      const store = items[0].store, own = items.filter(f => f.store === store);
      const ps = own.map(f => f.price);
      return {
        found: true, store, area: own[0].area, place: own[0].place || "", hours: own[0].hours || "",
        open_today: P.opensOn(own[0], twDow()), price_range: `${Math.min(...ps)}–${Math.max(...ps)}`, item_count: own.length,
        sample_items: own.filter(f => !f.noplan).slice(0, 15).map(f => `${f.item} ${f.price}`),
      };
    },
    make_week_plan(uid, a) {
      const p = getProfile(uid);
      if (a.budget) p.budget = Number(a.budget);
      const plan = P.makePlan(FOODS, p);
      const link = planLink(plan);
      return {
        _attach: P.planToText(plan) + (link ? `\n\n完整表格：${link}` : ""),   // 完整菜單直接附在回覆後面，不交給模型改寫
        total: plan.total, budget: plan.budget, left: plan.left, warnings: plan.warnings,
        note: "完整的一週菜單會由系統直接附在你的回覆後面，你只要用一兩句話說明已經排好、總花費多少即可，不要重複列出菜單。",
      };
    },
    update_preferences(uid, a) {
      const p = getProfile(uid);
      if (a.budget) p.budget = Number(a.budget);
      if (a.diet && DIET_KEYS[a.diet]) p.diet = DIET_KEYS[a.diet];
      if (a.muslim && MUSLIM_KEYS[a.muslim]) p.muslim = MUSLIM_KEYS[a.muslim];
      if (a.avoid_clear) p.avoid = [];
      if (Array.isArray(a.avoid_add)) p.avoid = [...new Set([...p.avoid, ...a.avoid_add.map(w => AVOID_KEYS[w]).filter(Boolean)])];
      if (Array.isArray(a.areas)) p.areas = a.areas.length ? a.areas.filter(x => AREAS.includes(x)) : AREAS.slice();
      return { ok: true, now: describe(p) };
    },
    get_preferences(uid) { return { now: describe(getProfile(uid)) }; },
  };
}

/* ---------- 對話紀錄與用量限制 ---------- */
const history = new Map();        // uid → { at, turns: [{role, text}] }
const HISTORY_MS = 30 * 60 * 1000, HISTORY_TURNS = 6;
const usage = { day: "", total: 0, users: new Map() };
function allow(uid) {
  const d = twDate();
  if (usage.day !== d) { usage.day = d; usage.total = 0; usage.users.clear(); }
  const n = usage.users.get(uid) || 0;
  if (n >= DAILY) return `今天的 AI 對話次數已經用完了（每人每天 ${DAILY} 則），明天再來聊 🙏\n固定指令（菜單、80、飲料…）還是可以用。`;
  if (usage.total >= GLOBAL) return "今天 AI 對話的總量已經到上限，明天再來聊 🙏\n固定指令（菜單、80、飲料…）還是可以用。";
  usage.users.set(uid, n + 1); usage.total++;
  return null;
}

function systemPrompt() {
  const d = twNow();
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getUTCDay()];
  return [
    "你是「台大平價餐點選單」的 LINE 小幫手，幫台大學生找校園附近（校內、水源市場、公館、新生南路、和平東路二段118巷）平價的吃的、喝的。",
    `今天是 ${twDate()}（星期${wd}），時間 ${d.toISOString().slice(11, 16)}（台灣時間）。`,
    "規則：",
    "1. 店名、餐點、價格、地點、營業時間只能用工具查到的資料，絕對不可以自己編造或用你原本知道的資訊。查不到就老實說沒有資料。",
    "2. 使用者提到想吃什麼、多少錢、在哪裡、哪家店，先呼叫工具再回答。條件不夠時可以先查「全部」，或簡短反問一個問題。",
    "3. 回答用繁體中文、口語、簡短：最多 8 行。列餐點時每行格式「・品名｜店名（區域）$價格」。",
    "4. LINE 不支援 Markdown，不要用 **、#、表格。可以用少量 emoji。",
    "5. 標示「待確認」的品項要提醒使用者先跟店家確認。",
    "6. 和吃飯、台大周邊美食無關的問題，用一句話友善地拉回主題。不要提供醫療、減重處方等專業建議。",
    "7. 使用者要求修改預算、素食、忌口、區域時才呼叫 update_preferences。",
  ].join("\n");
}

let useThinkingCfg = /gemini-3/.test(MODEL);   // Gemini 3 預設會「思考」，設成 low 讓回覆快一點、便宜一點
async function callGemini(contents, signal) {
  const generationConfig = { temperature: 0.4, maxOutputTokens: 2048 };
  if (useThinkingCfg) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const res = await fetch(`${API}/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt() }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DECLS }],
      generationConfig,
    }),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || res.statusText;
    if (res.status === 400 && useThinkingCfg && /thinking/i.test(msg)) { useThinkingCfg = false; return callGemini(contents, signal); }   // 這個模型不支援 thinkingLevel 就拿掉重試
    const err = new Error(`Gemini ${res.status}: ${msg}`); err.status = res.status; throw err;
  }
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content) throw new Error("Gemini 沒有回覆（可能被安全過濾）");
  return cand.content;
}

/**
 * 問 Gemini。回傳要給使用者的文字；失敗時回傳 null，由呼叫端改用原本的「看不懂」訊息。
 */
async function askGemini(uid, text, ctx) {
  if (!enabled()) return null;
  const limited = allow(uid);
  if (limited) return limited;
  const tools = makeTools(ctx);

  const h = history.get(uid);
  const past = h && Date.now() - h.at < HISTORY_MS ? h.turns : [];
  const contents = past.map(t => ({ role: t.role, parts: [{ text: t.text }] }));
  contents.push({ role: "user", parts: [{ text: text.slice(0, 500) }] });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25000);
  const attach = [];
  try {
    for (let round = 0; round < 4; round++) {
      const content = await callGemini(contents, ac.signal);
      const calls = (content.parts || []).filter(x => x.functionCall);
      if (!calls.length) {
        const answer = (content.parts || []).map(x => x.text || "").join("").trim()
          .replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
        const turns = [...past, { role: "user", text }, { role: "model", text: answer }].slice(-HISTORY_TURNS * 2);
        history.set(uid, { at: Date.now(), turns });
        return [answer || "我想一下…可以換個說法再問一次嗎？", ...attach].join("\n\n");
      }
      contents.push(content);   // 原封不動放回去（Gemini 3 需要 thought signature）
      const responses = calls.map(({ functionCall: fc }) => {
        let result;
        try { result = tools[fc.name] ? tools[fc.name](uid, fc.args || {}) : { error: "沒有這個工具" }; }
        catch (e) { result = { error: String(e.message || e) }; }
        if (result && result._attach) { attach.push(result._attach); delete result._attach; }
        return { functionResponse: { name: fc.name, response: result } };
      });
      contents.push({ role: "user", parts: responses });
    }
    return attach.length ? attach.join("\n\n") : "這個問題有點複雜，可以說得更具體一點嗎？例如「公館 80 元的晚餐」。";
  } catch (e) {
    console.error("[gemini]", e.message || e);
    if (e.status === 429) return "AI 小幫手現在太忙了（超過免費額度的速度限制），等一分鐘再試，或改用固定指令：菜單、80、飲料…";
    return null;
  } finally { clearTimeout(timer); }
}

module.exports = { askGemini, enabled, _internal: { makeTools, TOOL_DECLS, history, usage } };
