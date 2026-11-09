/*
 * planner.js —— 篩選與排餐的核心邏輯（網頁與 LINE Bot 共用，不碰 DOM）
 * 在瀏覽器中會掛在 window.Planner；在 Node.js 中用 require("./planner")。
 */
(function (root) {
  const MEALS = ["早餐", "午餐", "晚餐"];
  const DAYNAMES = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
  const WEEK = [1, 2, 3, 4, 5, 6, 0]; // 從週一排到週日
  const AREAS = ["校內", "水源市場", "公館", "新生南路", "118巷"];

  const TAGS = {
    pork: "豬肉", beef: "牛肉", chicken: "雞肉", seafood: "海鮮",
    egg: "蛋", dairy: "奶", peanut: "花生", alcohol: "酒", spicy: "辣",
  };
  const DIETS = {
    all: "不限",
    "flex-veg": "鍋邊素",
    "ovo-lacto": "蛋奶素",
    vegan: "全素",
  };
  const MUSLIM = {
    off: "不需要",
    friendly: "穆斯林友善（無豬、無酒）",
    halal: "僅清真認證／素食",
  };

  /** 預設的使用者條件 */
  function defaultProfile() {
    return {
      budget: 2000,
      reserve: 100,
      diet: "all",          // all | flex-veg | ovo-lacto | vegan
      muslim: "off",        // off | friendly | halal
      avoid: [],            // 例如 ["beef", "peanut"]
      prefer: [],           // 想多吃：["beef", "veg"]
      areas: AREAS.slice(),
      includeCheck: true,   // 可使用「待確認」的餐點
      extras: 3,            // 一週加幾次飲料／點心（0–14）
      extraKinds: ["飲料", "咖啡", "點心"],
    };
  }

  const has = (f, tag) => (f.contains || []).includes(tag);
  const isVeg = f => f.diet === "vegan" || f.diet === "ovo-lacto";
  const opensOn = (f, d) => !Array.isArray(f.days) || f.days.length === 0 || f.days.includes(d);

  /** 單一餐點是否符合條件；回傳 { ok, flags } ，flags 是要提醒使用者的標記 */
  function check(f, p) {
    const flags = [];
    if (f.status === "closed" || !(Number(f.price) > 0)) return { ok: false };
    if (f.status === "check") { if (!p.includeCheck) return { ok: false }; flags.push("待確認"); }
    if (p.areas && p.areas.length && !p.areas.includes(f.area)) return { ok: false };

    // 素食
    if (p.diet === "vegan" && f.diet !== "vegan") return { ok: false };
    if (p.diet === "ovo-lacto" && !isVeg(f)) return { ok: false };
    if (p.diet === "flex-veg") {
      if (!isVeg(f) && !f.flex) return { ok: false };
      if (f.flex) flags.push("自選素菜");
    }

    // 穆斯林
    if (p.muslim === "halal") {
      if (has(f, "alcohol")) return { ok: false };
      if (!f.halal && !isVeg(f)) return { ok: false };
      flags.push(f.halal ? "清真" : "素食・非認證");
    } else if (p.muslim === "friendly") {
      if (has(f, "pork") || has(f, "alcohol")) return { ok: false };
      if (f.halal) flags.push("清真");
      else if (!isVeg(f)) flags.push(f.flex ? "自選無豬菜" : "非清真認證");
    } else if (f.halal) flags.push("清真");

    // 忌口（自助餐可以自己避開）
    const hit = (p.avoid || []).filter(t => has(f, t));
    if (hit.length) return { ok: false };
    if (f.flex && (p.avoid || []).length) flags.push("避開" + p.avoid.map(t => TAGS[t] || t).join("、"));

    return { ok: true, flags: [...new Set(flags)] };
  }

  /** 偏好加權：符合想多吃的類型時權重較高 */
  function weight(o, p) {
    let w = 1;
    for (const f of o.parts) {
      for (const t of p.prefer || []) {
        if (t === "veg" ? isVeg(f) : has(f, t)) w += 2;
      }
    }
    return w;
  }

  function pickWeighted(arr, p, rnd) {
    const ws = arr.map(o => weight(o, p));
    let r = rnd() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < arr.length; i++) { r -= ws[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }

  function wrap(parts, p) {
    const flags = [...new Set(parts.flatMap(f => check(f, p).flags || []))];
    return { parts, price: parts.reduce((s, f) => s + Number(f.price), 0), flags, key: parts.map(f => f.id).sort().join("+") };
  }

  /** 從陣列中平均抽出最多 n 個（固定步長，結果穩定） */
  function thin(arr, n) {
    if (arr.length <= n) return arr;
    const out = [], step = arr.length / n;
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  /** 某一天某一餐的所有可選項目（含早餐「正餐＋飲料」組合） */
  function optionsFor(foods, slot, d, p, okFn) {
    const ok = okFn || (f => check(f, p).ok);
    const pool = foods.filter(f => opensOn(f, d) && ok(f));
    const singles = pool.filter(f => (f.meals || []).includes(slot)).map(f => wrap([f], p));
    if (slot !== "早餐") return singles;
    const mains = thin(pool.filter(f => f.kind === "正餐" && (f.meals || []).includes("早餐") && Number(f.price) <= 50), 60);
    const drinks = thin(pool.filter(f => (f.kind === "飲料" || f.kind === "咖啡") && Number(f.price) <= 35), 20);
    const out = singles.slice();
    for (const a of mains) for (const b of drinks) {
      if (Number(a.price) + Number(b.price) <= 80) out.push(wrap([a, b], p));
    }
    return out;
  }

  function extraOptions(foods, d, p, okFn) {
    const ok = okFn || (f => check(f, p).ok);
    return foods
      .filter(f => opensOn(f, d) && ok(f))
      .filter(f => (p.extraKinds || []).includes(f.kind) && ((f.meals || []).includes("點心") || (f.meals || []).includes("飲料")))
      .map(f => wrap([f], p));
  }

  /** 平均把 n 次加點分配到一週七天 */
  function extraDays(n) {
    n = Math.max(0, Math.min(14, Math.round(n || 0)));
    const count = new Array(7).fill(0);
    for (let i = 0; i < n; i++) count[Math.floor((i * 7) / n) % 7]++;
    return count; // 對應 WEEK 的順序
  }

  /**
   * 排一週菜單
   * @returns {{days, total, cap, budget, left, warnings, filled}}
   */
  function makePlan(foods, profile, opts) {
    const p = Object.assign(defaultProfile(), profile || {});
    const rnd = (opts && opts.random) || Math.random;
    const tries = (opts && opts.tries) || 200;
    const okCache = new Map();
    const okFn = f => { let v = okCache.get(f.id); if (v === undefined) { v = check(f, p).ok; okCache.set(f.id, v); } return v; };
    const maxOpts = (opts && opts.maxOpts) || 250;
    const cap = Math.max(0, (Number(p.budget) || 0) - (Number(p.reserve) || 0));

    const ex = extraDays(p.extras);
    const slots = [];
    WEEK.forEach((d, di) => {
      for (const m of MEALS) slots.push({ di, d, m, opts: thin(optionsFor(foods, m, d, p, okFn), maxOpts) });
      const exOpts = ex[di] ? thin(extraOptions(foods, d, p, okFn), maxOpts) : [];
      for (let k = 0; k < ex[di]; k++) slots.push({ di, d, m: "加點", opts: exOpts });
    });

    let best = null;
    for (let t = 0; t < tries; t++) {
      const usedKey = new Set(), useCount = new Map();
      const picks = []; let total = 0, missing = 0;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const leftSlots = slots.length - i;
        const pace = (cap - total) / leftSlots;
        const limit = f => (f.kind === "正餐" ? 1 : 2);
        let c = s.opts.filter(o => !usedKey.has(o.key) && o.parts.every(f => (useCount.get(f.id) || 0) < limit(f)));
        if (!c.length) c = s.opts.filter(o => o.parts.every(f => (useCount.get(f.id) || 0) < limit(f) + 1));
        if (!c.length) c = s.opts.slice();
        if (!c.length) { picks.push(null); missing++; continue; }
        let fit = c.filter(o => o.price <= pace * 1.4);
        if (!fit.length) fit = [c.reduce((a, b) => (a.price <= b.price ? a : b))];
        const o = pickWeighted(fit, p, rnd);
        usedKey.add(o.key);
        o.parts.forEach(f => useCount.set(f.id, (useCount.get(f.id) || 0) + 1));
        total += o.price; picks.push(o);
      }
      const repeats = [...useCount.values()].reduce((s, v) => s + Math.max(0, v - 1), 0);
      const stores = new Set(picks.filter(Boolean).flatMap(o => o.parts.map(f => f.store))).size;
      const within = total <= cap;
      const score = (within ? 1e6 : -total * 10) - missing * 1e5 - repeats * 300 + stores * 40 + (within ? total : 0)
        + picks.filter(Boolean).reduce((s, o) => s + (weight(o, p) - 1) * 25, 0);
      if (!best || score > best.score) best = { picks, total, score, within, missing, repeats };
    }

    // 整理成每天的表
    const days = WEEK.map(d => ({ dow: d, name: DAYNAMES[d], 早餐: null, 午餐: null, 晚餐: null, 加點: [], subtotal: 0 }));
    slots.forEach((s, i) => {
      const o = best.picks[i];
      if (s.m === "加點") { if (o) days[s.di].加點.push(o); }
      else days[s.di][s.m] = o;
      if (o) days[s.di].subtotal += o.price;
    });

    const warnings = [];
    if (best.missing) {
      const empty = slots.filter((s, i) => !best.picks[i]).map(s => `${DAYNAMES[s.d]}${s.m}`);
      warnings.push(`有 ${best.missing} 個時段找不到符合條件、當天有營業的餐點（${empty.slice(0, 6).join("、")}${empty.length > 6 ? "…" : ""}）。可以放寬忌口、區域，或勾選「待確認」的餐點。`);
    }
    if (!best.within) warnings.push(`即使挑最便宜的組合，合計 NT$${best.total} 仍超過「預算 − 預留」NT$${cap}。可以降低預留金、減少加點次數，或新增更便宜的餐點。`);
    if (best.repeats) warnings.push(`符合條件的餐點不多，有 ${best.repeats} 次重複安排。`);

    return { days, total: best.total, cap, budget: Number(p.budget) || 0, left: (Number(p.budget) || 0) - best.total, warnings, filled: !best.missing };
  }

  /** 依金額找餐點（含兩樣組合） */
  function findByPrice(foods, target, profile, o) {
    const p = Object.assign(defaultProfile(), profile || {});
    const tol = (o && o.tol) != null ? o.tol : 15;
    const meal = (o && o.meal) || "全部";
    const d = (o && o.dow) != null ? o.dow : new Date().getDay();
    const pool = foods.filter(f => opensOn(f, d) && check(f, p).ok);
    const mealOk = f => meal === "全部" || (f.meals || []).includes(meal);
    let hits = pool.filter(mealOk).filter(f => Math.abs(Number(f.price) - target) <= tol).map(f => wrap([f], p));
    if (o && o.combo) {
      // 主餐（符合餐別的正餐）＋配角（飲料／點心），只找價格加總落在範圍內的組合
      const mains = pool.filter(f => mealOk(f) && f.kind === "正餐" && Number(f.price) < target + tol);
      const sides = pool.filter(f => f.kind !== "正餐").sort((a, b) => a.price - b.price);
      const prices = sides.map(f => Number(f.price));
      const lower = x => { let lo = 0, hi = prices.length; while (lo < hi) { const m = (lo + hi) >> 1; if (prices[m] < x) lo = m + 1; else hi = m; } return lo; };
      const combos = [];
      for (const a of mains) {
        const pa = Number(a.price);
        for (let j = lower(target - tol - pa); j < sides.length && prices[j] <= target + tol - pa; j++) {
          if (sides[j].store === a.store || combos.length < 400 || Math.abs(pa + prices[j] - target) <= 2) combos.push([a, sides[j]]);
        }
      }
      combos.sort((x, y) => Math.abs(x[0].price + x[1].price - target) - Math.abs(y[0].price + y[1].price - target) || (x[0].store === x[1].store ? -1 : 1));
      for (const [a, b] of combos.slice(0, 200)) { const w = wrap([a, b], p); w.combo = true; hits.push(w); }
    }
    const near = h => Math.abs(h.price - target);
    const ok = hits.filter(h => near(h) <= tol);
    const sortFn = (a, b) => near(a) - near(b) || a.price - b.price;
    const singles = ok.filter(h => !h.combo).sort(sortFn).slice(0, (o && o.limit) || 120);
    const combos = ok.filter(h => h.combo).sort(sortFn).slice(0, (o && o.comboLimit) || 40);
    return singles.concat(combos);
  }

  /** 把菜單轉成純文字（LINE Bot 與「複製」按鈕用） */
  function planToText(plan) {
    const name = o => (o ? `${o.parts.map(f => f.item).join("＋")}（${[...new Set(o.parts.map(f => f.store))].join("、")}）$${o.price}` : "—");
    const lines = [`台大一週菜單｜合計 $${plan.total}／預算 $${plan.budget}，剩 $${plan.left}`];
    for (const d of plan.days) {
      lines.push(`\n【${d.name}】小計 $${d.subtotal}`);
      for (const m of MEALS) lines.push(`${m}：${name(d[m])}`);
      for (const x of d.加點) lines.push(`加點：${name(x)}`);
    }
    if (plan.warnings.length) lines.push("\n⚠ " + plan.warnings.join("\n⚠ "));
    return lines.join("\n");
  }

  const api = { MEALS, DAYNAMES, WEEK, AREAS, TAGS, DIETS, MUSLIM, defaultProfile, check, opensOn, optionsFor, makePlan, findByPrice, planToText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof window !== "undefined" ? window : globalThis);
