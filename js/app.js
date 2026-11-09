/*
 * app.js —— 網頁介面（依賴 data.js 的 FOODS 與 planner.js 的 Planner）
 * 使用者的條件與資料修改存在 localStorage，失敗時（無痕模式等）照常運作，只是不會記住。
 */
(function () {
  const P = window.Planner;
  const { DAYNAMES, WEEK, AREAS, TAGS, DIETS, MUSLIM } = P;
  const LS = { profile: "ntu-meal-profile", edits: "ntu-meal-edits", added: "ntu-meal-added", tab: "ntu-meal-tab", theme: "ntu-meal-theme" };

  /* ---------- 小工具 ---------- */
  const $ = id => document.getElementById(id);
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
    return n;
  }
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2200); }

  /** 單選 chip 群組 */
  function single(box, entries, current, onPick) {
    box.replaceChildren(...entries.map(([v, label]) => el("button", {
      class: "chip", type: "button", "aria-pressed": String(v === current), text: label,
      onclick: () => { onPick(v); [...box.children].forEach((c, i) => c.setAttribute("aria-pressed", String(entries[i][0] === v))); },
    })));
  }
  /** 多選 chip 群組（set 會被直接修改） */
  function multi(box, entries, set, onChange) {
    box.replaceChildren(...entries.map(([v, label]) => el("button", {
      class: "chip", type: "button", "aria-pressed": String(set.has(v)), text: label,
      onclick: e => { set.has(v) ? set.delete(v) : set.add(v); e.currentTarget.setAttribute("aria-pressed", String(set.has(v))); onChange && onChange(); },
    })));
  }

  /* ---------- 狀態 ---------- */
  const profile = Object.assign(P.defaultProfile(), load(LS.profile, {}));
  // 舊版存下的區域清單沒有後來新增的區域（例如 118巷）：預設把新區域加進去
  if ((profile.areasVersion || 1) < 2) { if (!profile.areas.includes("118巷")) profile.areas.push("118巷"); profile.areasVersion = 2; }
  profile.areas = AREAS.filter(a => profile.areas.includes(a));
  let edits = load(LS.edits, {});   // { id: { price, status } }
  let added = load(LS.added, []);   // 使用者新增的餐點
  const find = { tol: 15, meal: "全部" };
  let lastPlan = null;

  function foods() {
    return window.FOODS.map(f => (edits[f.id] ? Object.assign({}, f, edits[f.id]) : f)).concat(added);
  }
  function saveProfile() { save(LS.profile, profile); renderSummary(); }

  function flagPill(flag) {
    const cls = flag === "待確認" ? "check" : flag === "清真" ? "halal" : /素/.test(flag) ? "veg" : "note";
    return el("span", { class: "pill " + cls, text: flag });
  }
  function tagLine(f) {
    const diet = f.diet === "vegan" ? "全素" : f.diet === "ovo-lacto" ? "蛋奶素" : null;
    const c = (f.contains || []).map(t => TAGS[t] || t);
    return [diet, c.length ? "含" + c.join("、") : f.flex ? "自選菜色" : null].filter(Boolean).join("・");
  }

  /* ---------- 條件區 ---------- */
  function renderSummary() {
    const parts = [];
    if (profile.diet !== "all") parts.push(DIETS[profile.diet]);
    if (profile.muslim !== "off") parts.push(MUSLIM[profile.muslim]);
    if (profile.avoid.length) parts.push("不吃" + profile.avoid.map(t => TAGS[t]).join("、"));
    if (profile.areas.length < AREAS.length) parts.push(profile.areas.join("、"));
    $("profileSummary").textContent = parts.length ? "｜" + parts.join("；") : "｜不限";
  }
  function setupSettings() {
    const onChange = () => { saveProfile(); rerender(); };
    single($("dietChips"), Object.entries(DIETS), profile.diet, v => { profile.diet = v; onChange(); });
    single($("muslimChips"), Object.entries(MUSLIM), profile.muslim, v => { profile.muslim = v; onChange(); });

    const avoid = new Set(profile.avoid);
    multi($("avoidChips"), ["pork", "beef", "chicken", "seafood", "egg", "dairy", "peanut"].map(t => [t, TAGS[t]]), avoid,
      () => { profile.avoid = [...avoid]; onChange(); });

    const prefer = new Set(profile.prefer);
    multi($("preferChips"), [["beef", "牛肉"], ["pork", "豬肉"], ["chicken", "雞肉"], ["seafood", "海鮮"], ["veg", "蔬食"]], prefer,
      () => { profile.prefer = [...prefer]; onChange(); });

    const areas = new Set(profile.areas);
    multi($("areaChips"), AREAS.map(a => [a, a]), areas, () => { profile.areas = AREAS.filter(a => areas.has(a)); onChange(); });

    $("incCheck").checked = profile.includeCheck;
    $("incCheck").addEventListener("change", e => { profile.includeCheck = e.target.checked; onChange(); });
    renderSummary();
  }

  /* ---------- 排一週菜單 ---------- */
  function setupPlan() {
    $("budget").value = profile.budget; $("reserve").value = profile.reserve;
    $("extras").value = profile.extras; $("extrasOut").textContent = profile.extras;
    $("budget").addEventListener("change", e => { profile.budget = Math.max(0, Number(e.target.value) || 0); saveProfile(); renderPlan(); });
    $("reserve").addEventListener("change", e => { profile.reserve = Math.max(0, Number(e.target.value) || 0); saveProfile(); renderPlan(); });
    $("extras").addEventListener("input", e => { profile.extras = Number(e.target.value); $("extrasOut").textContent = profile.extras; });
    $("extras").addEventListener("change", () => { saveProfile(); renderPlan(); });
    const kinds = new Set(profile.extraKinds);
    multi($("extraKindChips"), ["飲料", "咖啡", "點心"].map(k => [k, k]), kinds, () => { profile.extraKinds = [...kinds]; saveProfile(); renderPlan(); });
    $("genPlan").addEventListener("click", renderPlan);
    $("printPlan").addEventListener("click", () => window.print());
    $("copyPlan").addEventListener("click", async () => {
      if (!lastPlan) return;
      try { await navigator.clipboard.writeText(P.planToText(lastPlan)); toast("已複製菜單文字"); }
      catch (e) { toast("無法複製，請改用列印"); }
    });
  }

  function cell(o) {
    if (!o) return el("td", { class: "warn", text: "沒有可選的餐點" });
    return el("td", {},
      el("div", {}, o.parts.map(f => f.item).join(" ＋ "), " ", el("span", { class: "p", text: String(o.price) })),
      el("div", { class: "meta", text: [...new Set(o.parts.map(f => f.store))].join("、") }),
      o.flags.length ? el("div", {}, o.flags.map(flagPill)) : null);
  }

  function renderPlan() {
    const plan = P.makePlan(foods(), profile);
    lastPlan = plan;
    let remaining = plan.budget;
    const rows = plan.days.map(d => {
      remaining -= d.subtotal;
      const pct = plan.budget ? Math.max(0, Math.min(100, (remaining / plan.budget) * 100)) : 0;
      const extra = d.加點.length
        ? el("td", {}, d.加點.map(x => el("div", { style: "margin-bottom:6px" },
            el("div", {}, x.parts[0].item, " ", el("span", { class: "p", text: String(x.price) })),
            el("div", { class: "meta", text: x.parts[0].store }))))
        : el("td", { class: "meta", text: "—" });
      return el("tr", {},
        el("th", { scope: "row", text: d.name }),
        cell(d.早餐), cell(d.午餐), cell(d.晚餐), extra,
        el("td", { class: "money", text: String(d.subtotal) }),
        el("td", { class: "money" }, String(remaining), el("div", { class: "left-bar" }, el("span", { style: `width:${pct}%` }))));
    });
    const table = el("table", {},
      el("thead", {}, el("tr", {}, ["", "早餐", "午餐", "晚餐", "加點", "小計", "剩餘"].map(h => el("th", { text: h })))),
      el("tbody", {}, rows));
    const leftOk = plan.left >= (Number(profile.reserve) || 0);
    $("planOut").replaceChildren(
      el("div", { class: "board" },
        el("div", { class: "totals" },
          el("div", {}, el("span", { class: "label", text: "七天合計" }), el("b", { text: `NT$${plan.total}` })),
          el("div", {}, el("span", { class: "label", text: "剩餘金額" }), el("b", { style: `color:var(${leftOk ? "--ok" : "--warn"})`, text: `NT$${plan.left}` })),
          el("div", {}, el("span", { class: "label", text: "平均每天" }), el("b", { text: `NT$${Math.round(plan.total / 7)}` }))),
        plan.warnings.map(w => el("p", { class: "warn", text: w }))),
      el("div", { class: "plan-wrap" }, table),
      el("p", { class: "notice", text: "價格與營業日以清單為準；標示「待確認」的餐點請先向店家確認。自助餐以一盤約 400 g 估價。" }));
  }

  /* ---------- 共用：同一間店的餐點合併 ---------- */
  /** 把餐點依店家分組，保留第一次出現的順序 */
  function groupByStore(list) {
    const map = new Map();
    for (const f of list) {
      if (!map.has(f.store)) map.set(f.store, { store: f.store, area: f.area, place: f.place, hours: f.hours, days: f.days, src: f.src, year: f.year, halal: false, items: [] });
      const g = map.get(f.store);
      g.items.push(f);
      if (f.halal) g.halal = true;
      if (!g.place && f.place) g.place = f.place;
      if (!g.hours && f.hours) g.hours = f.hours;
      if (!g.src && f.src) g.src = f.src;
    }
    return [...map.values()];
  }
  function daysText(days) {
    if (!days || !days.length) return "營業日未確認";
    if (days.length === 7) return "每天營業";
    const closed = WEEK.filter(d => !days.includes(d)).map(d => DAYNAMES[d].slice(1));
    return closed.length ? `週${closed.join("、")}休` : "每天營業";
  }
  function openOn(g, dow) { return !g.days || !g.days.length || g.days.includes(dow); }
  function priceRange(items) {
    const ps = items.filter(f => f.status !== "closed").map(f => Number(f.price)).filter(p => p > 0);
    if (!ps.length) return "";
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? `NT$${lo}` : `NT$${lo}–${hi}`;
  }
  const KIND_ORDER = ["正餐", "點心", "飲料", "咖啡"];
  function mapLink(g) {
    const q = encodeURIComponent(g.store + " " + (g.place || "") + " 台北");
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  /* ---------- 依金額找 ---------- */
  function setupFind() {
    single($("tolChips"), [10, 15, 20, 30].map(v => [v, "±" + v]), find.tol, v => { find.tol = v; renderFind(); });
    single($("mealChips"), ["全部", "早餐", "午餐", "晚餐", "點心", "飲料"].map(v => [v, v]), find.meal, v => { find.meal = v; renderFind(); });
    const today = new Date().getDay();
    $("dow").replaceChildren(...WEEK.map(d => el("option", { value: String(d), text: DAYNAMES[d] + (d === today ? "（今天）" : ""), selected: d === today ? "" : null })));
    let ft;
    $("target").addEventListener("input", () => { $("targetOut").textContent = $("target").value; clearTimeout(ft); ft = setTimeout(renderFind, 120); });
    $("dow").addEventListener("change", renderFind);
    $("combo").addEventListener("change", renderFind);
  }
  function diffText(diff) { return diff === 0 ? "剛好" : diff > 0 ? `多 ${diff}` : `省 ${-diff}`; }
  function renderFind() {
    const target = Number($("target").value), d = Number($("dow").value);
    $("targetOut").textContent = target;
    const hits = P.findByPrice(foods(), target, profile, { tol: find.tol, meal: find.meal, dow: d, combo: $("combo").checked });
    const box = $("findResults");
    const singles = hits.filter(h => !h.combo), combos = hits.filter(h => h.combo);
    // 單品依店家合併：店家順序依「最接近目標價」的那一道
    const groups = new Map();
    for (const h of singles) {
      const f = h.parts[0];
      if (!groups.has(f.store)) groups.set(f.store, { f, hits: [] });
      groups.get(f.store).hits.push(h);
    }
    $("findSummary").textContent = `${DAYNAMES[d]}有營業、NT$${target - find.tol}–${target + find.tol}：${groups.size} 家店、${singles.length} 道餐點` + (combos.length ? `，另有 ${combos.length} 組兩樣組合` : "");
    if (!hits.length) { box.replaceChildren(el("div", { class: "empty", text: "這個價位附近沒有符合條件的餐點。試著放寬差距、改選其他天、勾選「兩樣組合」，或調整上方的飲食條件。" })); return; }
    const cards = [...groups.values()].map(({ f, hits: hs }) => {
      hs.sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target) || a.price - b.price);
      return el("article", { class: "hit-store" },
        el("header", {},
          el("h3", {}, f.store, f.halal ? el("span", { class: "pill halal", text: "清真" }) : null),
          el("div", { class: "meta" }, el("span", { class: "area-tag", text: f.area }), [f.place, f.hours].filter(Boolean).join("・"))),
        el("ul", { class: "hit-items" }, hs.map(h => {
          const it = h.parts[0], diff = h.price - target;
          return el("li", {},
            el("span", { class: "name" }, it.item, h.flags.map(flagPill), el("span", { class: "tags", text: tagLine(it) })),
            el("span", { class: "price", text: String(h.price) }),
            el("span", { class: "diff" + (diff === 0 ? " exact" : ""), text: diffText(diff) }));
        })));
    });
    const comboBox = combos.length ? [
      el("h3", { class: "section-title", text: "兩樣組合" }),
      ...combos.map(h => {
        const diff = h.price - target;
        return el("div", { class: "tag" },
          el("div", { class: "price" }, String(h.price), el("small", { text: "NT$" })),
          el("div", { class: "what" },
            el("div", { class: "item" }, `${h.parts[0].item} ＋ ${h.parts[1].item}`, el("span", { class: "pill combo", text: "組合" }), h.flags.map(flagPill)),
            el("div", { class: "meta", text: h.parts.map(f => `${f.store} ${f.price} 元`).join("　＋　") })),
          el("div", { class: "diff", text: diffText(diff) + (diff ? " 元" : "") }));
      })] : [];
    box.replaceChildren(el("div", { class: "hit-grid" }, cards), ...comboBox);
  }

  /* ---------- 餐點資料（店家卡片） ---------- */
  const STATUS = { ok: "營業中", check: "待確認", closed: "已歇業" };
  const manage = { q: "", area: "全部", sort: "area", openToday: false, checkOnly: false, expandAll: false };
  const openStores = new Set();   // 使用者展開過的店家（重繪時保持展開）
  function setEdit(f, patch) {
    if (f._user) { Object.assign(f, patch); save(LS.added, added); }
    else { edits[f.id] = Object.assign({}, edits[f.id], patch, { updatedAt: new Date().toISOString().slice(0, 10) }); save(LS.edits, edits); }
    toast("已更新（存在這台裝置）"); rerender();
  }
  function itemRow(f) {
    const price = el("input", { type: "number", min: "1", value: String(f.price), "aria-label": `${f.item} 價格`, class: "price-in" });
    price.addEventListener("change", () => { const v = Number(price.value); if (v > 0 && v !== Number(f.price)) setEdit(f, { price: v }); });
    const sel = el("select", { "aria-label": `${f.item} 狀態`, class: "status-sel s-" + f.status }, Object.entries(STATUS).map(([k, v]) => el("option", { value: k, text: v, selected: k === f.status ? "" : null })));
    sel.addEventListener("change", () => setEdit(f, { status: sel.value }));
    const meals = (f.meals || []).filter(m => m !== "飲料").join("、");
    return el("li", { class: "irow" + (f.status === "closed" ? " closed" : "") + (edits[f.id] || f._user ? " edited" : "") },
      el("div", { class: "what" },
        el("div", { class: "item" }, f.item, f.status === "check" ? el("span", { class: "pill check", text: "待確認" }) : null,
          f.verify === "single" ? el("span", { class: "pill note", title: "只有 Google 地圖菜單一個來源，尚未用第二來源核對", text: "單一來源" }) : null,
          f.verify === "photo" ? el("span", { class: "pill note", title: "價格取自顧客拍攝的菜單照片", text: "照片價格" }) : null,
          f.verify === "double" ? el("span", { class: "pill veg", title: "兩個來源的價格一致", text: "已核對" }) : null,
          f._user ? el("span", { class: "pill note", text: "我新增的" }) : null),
        el("div", { class: "meta", text: [meals, tagLine(f), f.note].filter(Boolean).join("・") })),
      el("label", { class: "price-wrap" }, el("span", { class: "cur", text: "NT$" }), price),
      sel);
  }
  function storeCard(g) {
    const open = manage.expandAll || openStores.has(g.store) || (manage.q && g.items.length <= 12);
    const kinds = KIND_ORDER.filter(k => g.items.some(f => f.kind === k));
    const nCheck = g.items.filter(f => f.status === "check").length;
    const allClosed = g.items.every(f => f.status === "closed");
    const det = el("details", { class: "store" + (allClosed ? " closed" : ""), open: open ? "" : null },
      el("summary", {},
        el("div", { class: "s-main" },
          el("div", { class: "s-name" }, g.store,
            g.halal ? el("span", { class: "pill halal", text: "清真" }) : null,
            allClosed ? el("span", { class: "pill closed", text: "已歇業" }) : nCheck ? el("span", { class: "pill check", text: `${nCheck} 項待確認` }) : null,
            g.items.some(f => f.verify === "merchant") ? el("span", { class: "pill veg", title: "Google 地圖上的菜單由店家自行提供", text: "店家提供菜單" }) : null),
          el("div", { class: "meta" }, el("span", { class: "area-tag", text: g.area }), [g.place, daysText(g.days)].filter(Boolean).join("・"))),
        el("div", { class: "s-side" },
          el("div", { class: "s-range", text: priceRange(g.items) }),
          el("div", { class: "meta", text: `${g.items.length} 項・${kinds.join("／")}` }))),
      null);
    const body = () => el("div", { class: "s-body" },
        el("div", { class: "s-info" },
          g.hours ? el("div", {}, el("span", { class: "label", text: "營業時間" }), " ", g.hours) : null,
          el("div", { class: "links" },
            el("a", { href: mapLink(g), target: "_blank", rel: "noopener", text: "在 Google 地圖開啟" }),
            g.src && !/google\.com\/maps/.test(g.src) ? el("a", { href: g.src, target: "_blank", rel: "noopener", text: `資料來源${g.year ? "（" + g.year + "）" : ""}` }) : null)),
        kinds.map(k => el("div", { class: "kind-block" },
          kinds.length > 1 ? el("div", { class: "kind-title", text: k }) : null,
          el("ul", { class: "items" }, g.items.filter(f => f.kind === k).sort((a, b) => a.price - b.price).map(itemRow)))));
    if (open) det.append(body());
    det.addEventListener("toggle", () => {
      if (det.open) { openStores.add(g.store); if (!det.querySelector(".s-body")) det.append(body()); }
      else openStores.delete(g.store);
    });
    return det;
  }
  function renderManage() {
    const today = new Date().getDay();
    const q = manage.q.trim().toLowerCase();
    let groups = groupByStore(foods());
    if (manage.area !== "全部") groups = groups.filter(g => g.area === manage.area);
    if (manage.openToday) groups = groups.filter(g => openOn(g, today));
    if (manage.checkOnly) groups = groups.filter(g => g.items.some(f => f.status === "check"));
    if (q) {
      groups = groups.map(g => {
        const storeHit = [g.store, g.place, g.area].join(" ").toLowerCase().includes(q);
        return storeHit ? g : Object.assign({}, g, { items: g.items.filter(f => (f.item + " " + (f.note || "")).toLowerCase().includes(q)) });
      }).filter(g => g.items.length);
    }
    const minP = g => Math.min(...g.items.map(f => Number(f.price) || 9999));
    if (manage.sort === "cheap") groups.sort((a, b) => minP(a) - minP(b));
    else if (manage.sort === "name") groups.sort((a, b) => a.store.localeCompare(b.store, "zh-Hant"));
    const nItems = groups.reduce((s, g) => s + g.items.length, 0);
    $("manageSummary").textContent = `${groups.length} 家店、${nItems} 道餐點` + (q ? `（搜尋「${manage.q.trim()}」）` : "") + "。點店名展開菜單，可直接改價格或狀態。";
    $("mExpand").textContent = manage.expandAll ? "全部收合" : "全部展開";
    if (!groups.length) { $("manage").replaceChildren(el("div", { class: "empty", text: "找不到符合的店家或餐點。" })); return; }
    if (manage.sort === "area") {
      $("manage").replaceChildren(...AREAS.map(area => {
        const gs = groups.filter(g => g.area === area);
        if (!gs.length) return null;
        return el("section", { class: "area-group" },
          el("h3", { class: "section-title" }, area, el("span", { class: "count", text: `${gs.length} 家` })),
          el("div", { class: "store-list" }, gs.map(storeCard)));
      }).filter(Boolean));
    } else {
      $("manage").replaceChildren(el("div", { class: "store-list" }, groups.map(storeCard)));
    }
  }
  function setupManage() {
    single($("mArea"), ["全部", ...AREAS].map(a => [a, a]), manage.area, v => { manage.area = v; renderManage(); });
    let t;
    $("mSearch").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { manage.q = e.target.value; renderManage(); }, 150); });
    $("mSort").addEventListener("change", e => { manage.sort = e.target.value; renderManage(); });
    $("mOpenToday").addEventListener("change", e => { manage.openToday = e.target.checked; renderManage(); });
    $("mCheckOnly").addEventListener("change", e => { manage.checkOnly = e.target.checked; renderManage(); });
    $("mExpand").addEventListener("click", () => { manage.expandAll = !manage.expandAll; if (!manage.expandAll) openStores.clear(); renderManage(); });
  }

  function setupData() {
    $("fArea").replaceChildren(...AREAS.map(a => el("option", { text: a })));
    const dl = el("datalist", { id: "storeList" }, groupByStore(window.FOODS).map(g => el("option", { value: g.store })));
    document.body.append(dl); $("fStore").setAttribute("list", "storeList");
    $("fStore").addEventListener("change", () => {
      const g = groupByStore(foods()).find(x => x.store === $("fStore").value.trim());
      if (!g) return;
      $("fArea").value = g.area; if (!$("fPlace").value) $("fPlace").value = g.place || ""; if (!$("fHours").value) $("fHours").value = g.hours || "";
      if (g.days && g.days.length) { days.clear(); g.days.forEach(d => days.add(d)); [...$("fDays").children].forEach((c, i) => c.setAttribute("aria-pressed", String(days.has(WEEK[i])))); }
    });
    const meals = new Set(["午餐"]), contains = new Set(), days = new Set(WEEK);
    multi($("fMeals"), ["早餐", "午餐", "晚餐", "點心", "飲料"].map(m => [m, m]), meals);
    multi($("fContains"), Object.entries(TAGS), contains);
    multi($("fDays"), WEEK.map(d => [d, DAYNAMES[d]]), days);
    $("addForm").addEventListener("submit", e => {
      e.preventDefault();
      const f = {
        id: "u-" + Date.now().toString(36), _user: true,
        store: $("fStore").value.trim(), item: $("fItem").value.trim(), price: Number($("fPrice").value),
        area: $("fArea").value, kind: $("fKind").value, diet: $("fDiet").value, halal: $("fHalal").checked,
        place: $("fPlace").value.trim(), hours: $("fHours").value.trim(),
        meals: [...meals], contains: [...contains], days: [...days], status: "ok", note: "使用者新增", src: "", year: String(new Date().getFullYear()),
      };
      if (!f.store || !f.item || !(f.price > 0) || !f.meals.length) { toast("請填寫店家、餐點、價格，並至少選一個餐別"); return; }
      added.push(f); save(LS.added, added); e.target.reset(); toast("已加入清單"); rerender();
    });
    $("exportBtn").addEventListener("click", () => {
      const data = foods().map(f => { const c = Object.assign({}, f); delete c._user; return c; });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "ntu-foods.json" });
      document.body.append(a); a.click(); a.remove();
    });
    $("resetBtn").addEventListener("click", () => {
      if (!confirm("確定要清除你在這台裝置上的價格修改與新增的餐點嗎？")) return;
      edits = {}; added = []; save(LS.edits, edits); save(LS.added, added); toast("已清除"); rerender();
    });
  }

  /* ---------- 分頁、主題 ---------- */
  function setupTabs() {
    const tabs = [["tab-plan", "p-plan"], ["tab-find", "p-find"], ["tab-data", "p-data"]];
    tabs.forEach(([t, p]) => $(t).addEventListener("click", () => {
      tabs.forEach(([t2, p2]) => { $(t2).setAttribute("aria-selected", String(t2 === t)); $(p2).hidden = p2 !== p; });
      renderTab(t);
      save(LS.tab, t);
    }));
    const saved = load(LS.tab, null);
    if (saved && $(saved)) $(saved).click();
  }
  function setupTheme() {
    const apply = t => { if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme"); };
    apply(load(LS.theme, null));
    $("themeBtn").addEventListener("click", () => {
      const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
        (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
      const t = dark ? "light" : "dark"; apply(t); save(LS.theme, t);
    });
  }

  /* 只重繪目前顯示的分頁，其他分頁等切過去時再畫 */
  const dirty = { "tab-plan": true, "tab-find": true, "tab-data": true };
  const renderers = { "tab-plan": () => renderPlan(), "tab-find": () => renderFind(), "tab-data": () => renderManage() };
  function activeTab() { return ["tab-plan", "tab-find", "tab-data"].find(t => $(t).getAttribute("aria-selected") === "true") || "tab-plan"; }
  function renderTab(t) { if (dirty[t]) { dirty[t] = false; renderers[t](); } }
  function rerender() { Object.keys(dirty).forEach(k => (dirty[k] = true)); renderTab(activeTab()); }

  setupTheme(); setupSettings(); setupPlan(); setupFind(); setupManage(); setupData(); setupTabs();
  rerender();
})();
