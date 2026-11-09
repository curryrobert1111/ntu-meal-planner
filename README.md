# 台大平價餐點選單

一週預算（預設 NT$2000）自動排出七天三餐，可加飲料、咖啡或點心；範圍包含台大校內、水源市場、公館、新生南路與和平東路 118 巷一帶。
支援素食（全素／蛋奶素／鍋邊素）、穆斯林友善／清真、忌口（豬、牛、雞、海鮮、蛋、奶、花生）與「想多吃」偏好。

## 檔案結構

```
ntu-meal-planner/
├─ index.html          網頁主體
├─ css/style.css       樣式（含深色模式、手機版、列印版）
├─ js/data.js          餐點資料（要新增店家改這裡）
├─ js/planner.js       排餐與篩選邏輯（網頁與 LINE Bot 共用）
├─ js/app.js           網頁互動
├─ linebot/            LINE Bot（Node.js）
│  ├─ index.js
│  ├─ package.json
│  └─ .env.example
└─ .gitignore
```

本機預覽：直接用瀏覽器打開 `index.html` 即可，不需要安裝任何東西。

## 新增或修改餐點

打開 `js/data.js`，照既有格式加一行，例如：

```js
{ id: "abc-beefnoodle", store: "某某牛肉麵", item: "紅燒牛肉麵", price: 160, area: "公館",
  place: "汀州路三段 1 號", hours: "11:00–20:00", days: [1,2,3,4,5,6],
  meals: ["午餐","晚餐"], kind: "正餐", diet: "meat", contains: ["beef"],
  status: "ok", note: "", src: "資料來源網址", year: "2026" },
```

也可以在網頁的「餐點資料」分頁修改／新增，再按「匯出 JSON」把結果貼回 `data.js`。

---

## 一、用 GitHub Pages 上架網頁（免費）

1. 註冊／登入 <https://github.com>。
2. 右上角「＋」→ **New repository**，名稱填 `ntu-meal-planner`，選 **Public**，按 **Create repository**。
3. 在新 repo 頁面點 **uploading an existing file**，把整個資料夾的內容（`index.html`、`css/`、`js/`、`linebot/`、`README.md`、`.gitignore`）拖進去，按 **Commit changes**。
   - 不要上傳 `linebot/node_modules/` 和 `.env`。
   - 會用 git 的話：
     ```bash
     cd ntu-meal-planner
     git init && git add . && git commit -m "first version"
     git branch -M main
     git remote add origin https://github.com/你的帳號/ntu-meal-planner.git
     git push -u origin main
     ```
4. repo 的 **Settings → Pages**：
   - Source 選 **Deploy from a branch**
   - Branch 選 **main**、資料夾 **/(root)**，按 **Save**。
5. 等 1–2 分鐘，網址會出現在同一頁：`https://你的帳號.github.io/ntu-meal-planner/`
6. 之後修改檔案、commit，網站會在一兩分鐘內自動更新。

> 注意：網頁上的修改只存在使用者自己的瀏覽器（localStorage）。要讓所有人看到新資料，必須改 `js/data.js` 再推上 GitHub。

---

## 二、LINE 上架

有兩種做法，可以只做 A，也可以 A＋B 一起做。

### A. 不寫程式：官方帳號＋圖文選單連到網頁

1. 到 **LINE Official Account Manager**（<https://manager.line.biz>）用 LINE 帳號登入，建立一個官方帳號（一般帳號免費）。
2. 左側 **聊天室相關 → 圖文選單** → 建立，版型選一格或兩格：
   - 動作類型選 **連結**，填上 GitHub Pages 網址。
   - 可再加一格「文字」動作，例如傳送「菜單」（給 B 的 Bot 用）。
3. 設定顯示期間、儲存並啟用。
4. **主頁 → 加入好友工具** 可以拿到 QR code 與加好友連結，貼到課程或社群即可。

### B. 寫程式：Messaging API 聊天機器人（`linebot/`）

使用者在聊天室傳「菜單」「預算 1500」「全素」「不吃 牛肉」「60元」等，Bot 直接回覆一週菜單或餐點清單。

**1. 開啟 Messaging API**

1. 在 LINE Official Account Manager 進入剛才的官方帳號 → 右上 **設定 → Messaging API → 啟用 Messaging API**，選擇或建立一個 Provider。
   （LINE 目前要求先有官方帳號，再從這裡啟用；無法直接在 Developers Console 新建 Messaging API channel。）
2. 到 **LINE Developers Console**（<https://developers.line.biz/console/>）找到該 channel：
   - **Basic settings** → 複製 **Channel secret**
   - **Messaging API** → **Channel access token (long-lived)** 按 **Issue** → 複製
3. 回到 Official Account Manager → **設定 → 回應設定**：開啟 **Webhook**，關閉「自動回應訊息」（否則會跟 Bot 一起回）。

**2. 本機測試**

```bash
cd linebot
cp .env.example .env      # 填入 Channel secret 與 access token
npm install
npm start                 # 伺服器在 http://localhost:3000
```

LINE 需要公開的 HTTPS 網址，本機測試可用 ngrok：`ngrok http 3000`，把得到的 `https://xxxx.ngrok-free.app/webhook` 填到下一步的 Webhook URL。

**3. 部署到雲端（以 Render 為例，免費方案即可）**

1. 到 <https://render.com> 用 GitHub 登入 → **New → Web Service** → 選 `ntu-meal-planner` repo。
2. 設定：
   - **Root Directory**：留空（Bot 需要讀到上一層的 `js/`）
   - **Build Command**：`cd linebot && npm install`
   - **Start Command**：`node linebot/index.js`
   - **Environment**：新增 `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`WEB_URL`（GitHub Pages 網址）
3. 部署完成後會得到 `https://xxx.onrender.com`。
4. 回到 LINE Developers → **Messaging API → Webhook settings**：
   - Webhook URL 填 `https://xxx.onrender.com/webhook` → **Update** → **Verify**（顯示 Success 即成功）
   - 開啟 **Use webhook**
5. 用手機掃 **Messaging API** 頁面上的 QR code 加好友，傳「說明」測試。

> Render 免費方案閒置約 15 分鐘會休眠，第一則訊息可能要等數十秒才喚醒；若常遇到沒回應，可改用付費方案或 Google Cloud Run、Fly.io 等。
> 使用者設定（預算、忌口）目前存在記憶體，重新部署後會清空；需要長期保存可接 Firestore 或 Redis。

**4. 推廣**

- Official Account Manager → **加入好友工具** 取得 QR code。
- 圖文選單可放「排菜單」「60 元」「設定」等按鈕（動作選「文字」）。

---

## 資料說明與限制

- 價格來自 2022–2026 年的公開資料；2026-11 擴充的店家（共 138 家、4075 筆，含和平東路二段 118 巷；Google 菜單只有外送價的店已移除）地址、營業時間與價格取自 Google 地圖商家資料，標示「待確認」的請先向店家確認。
- 素食、成分（豬、牛、蛋、奶、花生…）是依店名與餐名的推測；有過敏或宗教飲食需求請以店家說明為準。
- 「穆斯林友善」只排除含豬肉與酒的品項，**不等於清真認證**；「僅清真認證／素食」只會選台灣清真推廣中心列出的穆斯林餐廳與素食品項。台大膳委會另有「穆斯林友善餐廳」地圖：<https://meals.ntu.edu.tw/board/detail/sn/2107>。
- 自助餐以一盤約 400 g（18 元/100 g）估 75 元，實際依取菜量而定。
