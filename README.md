# 台大平價餐點選單

一週預算（預設 NT$2000）自動排出七天三餐，可加飲料、咖啡或點心；範圍包含台大校內、水源市場、公館、新生南路與和平東路 118 巷一帶。
支援素食（全素／蛋奶素／鍋邊素）、穆斯林友善／清真、忌口（豬、牛、雞、海鮮、蛋、奶、花生）與「想多吃」偏好。

- 網站：<https://curryrobert1111.github.io/ntu-meal-planner/>
- LINE 官方帳號：<https://lin.ee/xlmjIhlx>（圖文選單連到網站；聊天機器人可查價位、排菜單，並用 Gemini AI 回答自由提問）

## 檔案結構

```
ntu-meal-planner/
├─ index.html          網頁主體
├─ css/style.css       樣式（含深色模式、手機版、列印版）
├─ js/data.js          餐點資料（要新增店家改這裡）
├─ js/planner.js       排餐與篩選邏輯（網頁與 LINE Bot 共用）
├─ js/app.js           網頁互動
├─ linebot/            LINE Bot（Node.js）
│  ├─ index.js         收訊息、固定指令；看不懂的交給 gemini.js
│  ├─ gemini.js        Gemini AI 自由對話（查詢工具、每日上限）
│  ├─ memes.js         梗小辭典（台大／在地用語，要新增梗改這裡）
│  ├─ package.json
│  ├─ .env.example     環境變數範本
│  ├─ GEMINI.md        Gemini 設定教學
│  └─ CLOUD_RUN.md     改部署到 Google Cloud Run 的教學
├─ Dockerfile          Cloud Run 用（Render 不需要）
├─ .dockerignore
├─ .gitattributes      統一換行符號（LF）
└─ .gitignore
```

本機預覽：直接用瀏覽器打開 `index.html` 即可，不需要安裝任何東西。

LINE Bot 的說明見下方「LINE 官方帳號與聊天機器人」。


## 新增或修改餐點

打開 `js/data.js`，照既有格式加一行，例如：

```js
{ id: "abc-beefnoodle", store: "某某牛肉麵", item: "紅燒牛肉麵", price: 160, area: "公館",
  place: "汀州路三段 1 號", hours: "11:00–20:00", days: [1,2,3,4,5,6],
  meals: ["午餐","晚餐"], kind: "正餐", diet: "meat", contains: ["beef"],
  status: "ok", note: "", src: "資料來源網址", year: "2026" },
```

欄位說明補充：
- `kind` 是「正餐／點心／飲料／咖啡」。小菜、配料、滷味請標「點心」，不要標「正餐」。
- `noplan: true` 表示這筆不列入自動排餐，例如品名不完整（只寫「肉鬆」「起司」，其實是吐司或蛋餅的口味），或是沒附飯麵的合菜（清炒高麗菜、麻婆豆腐）。
- 自動排餐時，午餐、晚餐至少要 50 元的正餐，早餐至少 25 元；早餐的「正餐＋飲料」組合會優先配同一家店。

也可以在網頁的「餐點資料」分頁修改／新增，再按「匯出 JSON」把結果貼回 `data.js`。

注意：網頁上的修改只存在使用者自己的瀏覽器（localStorage）。要讓所有人看到新資料，必須改 `js/data.js` 再 push 上 GitHub（流程見下一節）。

---

## LINE 官方帳號與聊天機器人

### 架構

```
使用者（LINE） ──> LINE 平台 ──Webhook──> Render 上的 linebot/index.js
                                              │
                         固定指令（菜單、80、全素…）直接回覆
                                              │ 看不懂的句子
                                              v
                                   linebot/gemini.js ──> Gemini API
                                   （AI 先呼叫查詢工具讀 js/data.js，再組成回答）
```

- 網頁和 Bot 共用 `js/data.js` 與 `js/planner.js`：改資料並 push 後，網頁（GitHub Pages）和 Bot（Render 自動重新部署）都會更新。
- 使用者的條件（預算、素食、忌口）與 AI 對話紀錄只存在伺服器記憶體，伺服器休眠或重新部署後會清空；不另外儲存使用者資料。

### 固定指令（不經過 AI，不佔 Gemini 額度）

整則訊息必須**完全相同**（前後空白會忽略）；多了其他字（例如「菜單謝謝」）就會交給 AI。

| 類別 | 傳送內容 | Bot 回覆 |
|---|---|---|
| 說明 | `說明`、`help`、`?`、`？` | 指令列表（加好友時也會自動傳送） |
| 查看設定 | `設定`、`條件` | 顯示目前條件 |
| 預算 | `預算 1500`、`預留 300`、`加點 3` | 設定一週預算、預留金、加點次數（最多 14） |
| 素食 | `全素`、`蛋奶素`、`鍋邊素`；`不限素食`、`取消素食` | 設定／取消素食條件 |
| 穆斯林 | `穆斯林友善`、`穆斯林`；`清真`、`清真認證`、`halal`；`取消穆斯林` | 排除豬肉與酒／只選清真認證／取消 |
| 忌口 | `不吃 牛肉 海鮮`（豬肉、牛肉、雞肉、海鮮、蛋、奶、花生）；`清除忌口` | 加入／清空忌口 |
| 菜單 | `菜單`、`排菜單`、`一週菜單`、`排餐` | 一週菜單＋「完整表格」連結（網頁會顯示同一份菜單） |
| 依金額找 | 只傳金額：`80`、`80元`、`80塊`、`$80`（10～999，全形數字也可以） | 先問要哪一類（附按鈕） |
| 依金額找 | 只傳類別：`正餐`、`早餐`、`午餐`、`晚餐`、`飲料`、`咖啡`、`點心`、`全部` | 先問要多少錢（附按鈕） |
| 依金額找 | 類別別名：`主餐`、`吃飯`、`飯`（＝正餐）；`喝的`、`手搖`、`手搖飲`、`茶`（＝飲料）；`甜點`、`小吃`（＝點心）；`不限`、`都可以`（＝全部） | 同對應的類別 |
| 依金額找 | 類別＋金額：`正餐 80`、`80 飲料`、`飲料80元`；或先傳金額、不久後再傳類別 | 直接列出今天有營業的餐點（每家最多 2 筆） |
| 非文字 | 貼圖、圖片、位置、語音 | 不回覆 |

指令都寫在 `linebot/index.js` 的 `handleText()`，每個 `if` 是一條規則；「說明」的文字是同檔案的 `HELP`。

### AI 自由對話（Gemini）

不屬於上表的文字（例如「公館有什麼便宜的拉麵」「今天下雨想在校內吃」「你好」）會交給 Google Gemini（預設 `gemini-3.5-flash-lite`）。

- **資料不會亂編**：AI 要先呼叫查詢工具（找餐點、查店家、排菜單、改條件）讀 `js/data.js`，店名、價格、營業時間只能用查到的資料；一週菜單由程式產生後直接附上，不經 AI 改寫。
- **閒聊與網路梗**：可以用模型本身的知識接梗、閒聊，再帶回找吃的；不捏造名人言論、不嘲笑任何人。寫作業、寫程式等無關任務會婉拒。
- **梗小辭典**：模型不懂的台大／在地用語寫在 `linebot/memes.js`（目前有統神「早餐吃到飽」、活大、小福），照格式新增即可。每筆 1～2 句，太長會讓每則對話變慢、變貴。
- 設定步驟與常見錯誤見 [`linebot/GEMINI.md`](linebot/GEMINI.md)。

### 用量與費用

| 方案 | 額度 | 約可回覆 | 費用 |
|---|---|---|---|
| 免費（目前） | 3.5 Flash-Lite 每分鐘 15 次、每天 500 次請求 | 每天約 250～400 則 AI 對話 | 0 元；Google 可能用對話內容改進產品 |
| 付費（Tier 1） | 上限高很多（以 AI Studio 顯示為準） | 依預算 | 需預付至少 5 美元；估計每 1,000 則 AI 對話約 NT$70，換 3.5 Flash 約 NT$300 |

- 一則 AI 對話約用 1～3 次請求：純聊天 1 次，需要查資料 2 次，排菜單或多次查詢 3 次。固定指令不計入。
- 免費額度依美國太平洋時間每天重置（台灣下午 3～4 點）；用完時 AI 會回「太忙了」，固定指令照常可用。
- 改用 `gemini-3.5-flash` 比較聰明、懂更多梗，但免費方案每天只有約 20 次請求，只適合展示。
- 實際額度與用量看 <https://aistudio.google.com/rate-limit>；付費時到 <https://aistudio.google.com/spend> 設定花費上限。

### 環境變數（Render → Environment）

| 名稱 | 說明 |
|---|---|
| `LINE_CHANNEL_SECRET` | LINE Developers → Basic settings → Channel secret（必填） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Messaging API → Channel access token（必填） |
| `WEB_URL` | 網站網址，用來產生「完整表格」連結 |
| `GEMINI_API_KEY` | Google AI Studio 的 API 金鑰；不填就只有固定指令 |
| `GEMINI_MODEL` | 預設 `gemini-3.5-flash-lite`；模型下架時改這裡即可 |
| `AI_DAILY_LIMIT` | 每人每天最多幾則 AI 回覆，預設 30 |
| `AI_GLOBAL_LIMIT` | 全站每天最多幾則 AI 回覆，預設 1500；免費方案建議設 **450**（3.5 Flash 免費方案設 18） |
| `AI_WEB_SEARCH` | 設成 `1` 讓 AI 遇到看不懂的梗可以上 Google 查；每月前 5,000 次搜尋免費，之後每 1,000 次約 14 美元 |

金鑰等同密碼：只填在 Render，不要寫進程式或推上 GitHub。本機測試時寫在 `linebot/.env`（已被 `.gitignore` 排除）。

### 部署（Render，免費方案）

| 欄位 | 設定 |
|---|---|
| Language | Node |
| Branch | `main` |
| Region | Singapore |
| Build Command | `cd linebot && npm install` |
| Start Command | `node linebot/index.js` |

- LINE Developers → Messaging API → Webhook URL 填 `https://你的服務.onrender.com/webhook`（結尾要有 `/webhook`），打開 Use webhook，Webhook redelivery 保持關閉；Official Account Manager 的「自動回應訊息」要關閉。
- 免費方案閒置 15 分鐘會休眠，喚醒約需 1 分鐘，期間第一則訊息可能沒有回應。可用 <https://cron-job.org> 每 10 分鐘呼叫一次服務網址保持喚醒，或改部署到 Google Cloud Run（見 [`linebot/CLOUD_RUN.md`](linebot/CLOUD_RUN.md)）。
- 看記錄（Logs）出現 `LINE bot listening on …（AI 對話：開啟）` 代表啟動成功且有讀到 Gemini 金鑰。

---

## 一起開發：用 Git 與 GitHub 協作

- 程式碼：<https://github.com/curryrobert1111/ntu-meal-planner>
- 網站：<https://curryrobert1111.github.io/ntu-meal-planner/>（push 到 `main` 後 1–2 分鐘自動更新）

### 0. 事前準備（只做一次）

1. 註冊 GitHub 帳號，把**帳號名稱**告訴管理者（curryrobert1111），等他邀請你。
2. 收到邀請後，從 email 或 <https://github.com/notifications> 按 **Accept invitation**。接受後才能 push。
3. 安裝 Git（下載與安裝步驟見下方「安裝 Git」）。
4. 打開終端機（Windows 用「Git Bash」，操作方式見下方「Git Bash 基本操作」），設定你的名字與 email（會顯示在每次修改紀錄上）：

```
git config --global user.name "你的名字"
git config --global user.email "你的 GitHub email"
```

> 不想打指令也可以用 [GitHub Desktop](https://desktop.github.com/)，步驟對照見本節最後。

### 安裝 Git

**Windows**

1. 到 <https://git-scm.com/downloads/win>，點 **Click here to download**（會下載 `Git-x.xx.x-64-bit.exe`）。
2. 執行下載的檔案，大部分畫面直接按 **Next** 用預設值即可，只有兩個地方建議改：
   - **Choosing the default editor used by Git**：預設是 Vim（新手很難操作），改選 **Use Notepad as Git's default editor**（記事本），有裝 VS Code 的話選 **Use Visual Studio Code**。
   - **Adjusting the name of the initial branch in new repositories**：選 **Override the default branch name**，填 `main`（和本專案一致）。
   - 其他像 PATH、HTTPS、換行符號、Git Credential Manager 都維持預設，最後按 **Install**。
3. 裝好後，從開始選單打開 **Git Bash**，輸入下面指令，看到 `git version 2.xx...` 就成功了：

```
git --version
```

> 會用指令的話，也可以在 PowerShell 輸入 `winget install --id Git.Git -e` 一行安裝。

**macOS**

打開「終端機」輸入 `git --version`。如果還沒安裝，系統會跳出視窗問要不要安裝「命令列開發者工具」，按 **安裝** 即可（或 `xcode-select --install`）。有裝 Homebrew 的話也可以用 `brew install git`。

**已經安裝過？** 一樣用 `git --version` 確認；版本太舊（2.30 以前）建議重新下載安裝新版覆蓋。

### Git Bash 基本操作（Windows）

Git Bash 是安裝 Git 時一起裝好的終端機，上面所有 `git` 指令都在這裡輸入。

**打開 Git Bash 並進到專案資料夾**

- 最簡單：在檔案總管打開 `ntu-meal-planner` 資料夾，在空白處按右鍵 →（Windows 11 先點「顯示其他選項」）→ **Open Git Bash here**，開啟後就已經在專案資料夾裡。
- 或從開始選單打開 Git Bash，再用 `cd` 切過去。Windows 的 `C:\Users\你\Desktop` 在 Git Bash 裡寫成 `/c/Users/你/Desktop`，路徑有空格或中文時要加引號：

```
cd "/c/Users/你的使用者名稱/OneDrive/桌面/ntu-meal-planner"
```

> 也可以輸入 `cd ` 後，把資料夾從檔案總管直接拖進 Git Bash 視窗，路徑會自動填好。

**常用指令**

| 指令 | 作用 |
|---|---|
| `pwd` | 顯示現在在哪個資料夾 |
| `ls` | 列出目前資料夾的檔案（`ls -a` 連隱藏檔一起列） |
| `cd 資料夾名` | 進入資料夾；`cd ..` 回上一層；`cd ~` 回家目錄 |
| `explorer .` | 用檔案總管打開目前資料夾 |
| `start index.html` | 用預設瀏覽器打開網頁預覽 |
| `code .` | 用 VS Code 打開整個專案（有裝 VS Code 才能用） |
| `clear` | 清空畫面 |
| `git log --oneline` | 看修改紀錄（一行一筆） |

**操作小技巧**

- **Tab 鍵自動補完**：打檔名或資料夾名的前幾個字按 Tab，會自動補完。
- **↑ / ↓ 方向鍵**：叫出之前輸入過的指令，不用重打。
- **複製／貼上**：Git Bash 裡的 Ctrl+C 是「中斷執行」不是複製。複製用滑鼠選取（選取即複製）或 Ctrl+Insert，貼上用 **Shift+Insert** 或按右鍵 → Paste。
- **畫面停住、底下出現 `:` 或 `(END)`**（例如 `git log` 時）：按 `q` 離開。
- **跳進 vim 編輯器**（例如 `git pull` 要你寫合併訊息、畫面上方有說明文字、左邊一排 `~`）：
  - 用預設訊息就好：輸入 `:wq` 再按 Enter（存檔離開）。
  - 想放棄：按 Esc，輸入 `:q!` 再按 Enter。
  - 不想再遇到 vim，可以改成用記事本：`git config --global core.editor notepad`
- **中文檔名在 `git status` 顯示成 `\346\241\214...`**：執行一次 `git config --global core.quotepath false` 就會正常顯示中文。
- 指令跑很久或卡住：按 **Ctrl+C** 中斷。

### 1. 把專案下載到電腦（clone，只做一次）

```
git clone https://github.com/curryrobert1111/ntu-meal-planner.git
cd ntu-meal-planner
```

第一次 push 時會跳出 GitHub 登入視窗，用瀏覽器登入授權即可。**不要在終端機輸入 GitHub 密碼**（GitHub 已不接受密碼登入）。

### 2. 每次修改的流程

```
git pull                         # ① 先抓別人最新的修改（每次動手前都要做）
# ② 修改檔案，用瀏覽器打開 index.html 確認沒壞
git status                       # ③ 看改了哪些檔案
git add .                        # ④ 把修改加入這次的提交
git commit -m "更新公館豆花價格"   # ⑤ 寫一句話說明改了什麼
git push                         # ⑥ 上傳到 GitHub，網站一兩分鐘後更新
```

網站沒變的話，等一下再按 Ctrl+F5 重新整理；repo 的 **Actions** 分頁可以看部署進度（綠勾代表完成）。

### 3. push 被拒絕怎麼辦

看到 `! [rejected] main -> main (fetch first)` 代表別人在你之後先 push 了。先把他的修改抓下來再 push：

```
git pull
git push
```

`git pull` 時如果跳出編輯器要你寫合併訊息，直接存檔關閉即可（vim：輸入 `:wq` 後按 Enter）。

### 4. 遇到衝突（conflict）

兩個人改到同一個檔案的同一段時，`git pull` 會顯示 `CONFLICT`。打開那個檔案會看到：

```
<<<<<<< HEAD
    { id: "x1", store: "某店", item: "排骨飯", price: 100, ... },   ← 你的版本
=======
    { id: "x1", store: "某店", item: "排骨飯", price: 105, ... },   ← 別人的版本
>>>>>>> origin/main
```

1. 決定要留哪一行（或合併兩者），把 `<<<<<<<`、`=======`、`>>>>>>>` 三行標記刪掉。
2. 存檔後：

```
git add .
git commit -m "合併衝突"
git push
```

搞不清楚的話可以先 `git merge --abort` 回到 pull 之前的狀態，再找人一起看。

### 5. 協作守則

- **動手前先 `git pull`，改完盡快 `push`**，越久沒同步越容易衝突。
- 一次 commit 只做一件事，訊息寫清楚（例：「新增 118 巷某某麵店 12 項」「修正女九自助餐價格」）。
- 要大改 `js/data.js` 前先在群組說一聲，避免兩人同時改同一家店。
- 不要上傳 `.env`（LINE 金鑰）和 `node_modules/`，`.gitignore` 已經排除了。
- push 前用瀏覽器打開 `index.html` 試一下，網站壞了大家都會看到。

### 6. 進階：用分支＋Pull Request（大改功能時建議）

想先給別人看過再上線，就不要直接改 `main`：

```
git switch -c add-new-stores       # 開一個新分支
# 修改、git add、git commit
git push -u origin add-new-stores
```

接著到 GitHub repo 頁面按 **Compare & pull request** → 寫說明 → **Create pull request**。
其他人可以在 PR 上留言；確認沒問題後按 **Merge pull request** 才會上線。合併後回到 main：

```
git switch main
git pull
```

### 7. 管理者：邀請協作者

repo 的 **Settings → Collaborators → Add people**，輸入對方的 GitHub 帳號或 email。
邀請 7 天內沒接受會失效，到同一頁重新邀請即可。
沒有被邀請的人也能參與：在 repo 按 **Fork** 複製一份到自己帳號，改完送 Pull Request，由管理者決定是否合併。

### GitHub Desktop 對照

| 指令 | GitHub Desktop |
|---|---|
| `git clone` | File → Clone repository → 選 `ntu-meal-planner` |
| `git pull` | 上方 **Fetch origin** → **Pull origin** |
| `git add` + `git commit` | 左下填說明 → **Commit to main** |
| `git push` | 上方 **Push origin** |
| 開分支 | 上方 Current branch → **New branch** |

---

## 資料說明與限制

- 價格來自 2022–2026 年的公開資料；2026-11 擴充的店家（共 190 家、5879 筆，含和平東路二段 118 巷與 52 家飲料店、咖啡廳、甜點店；飲料只收咖啡廳、飲料店、甜點店與早餐店的品項，其他正餐店附帶的飲料不列入；連鎖飲料店價格取自 2026 年整理的北部價目表；Google 菜單只有外送價的店已移除）地址、營業時間與價格取自 Google 地圖商家資料，標示「待確認」的請先向店家確認。
- 素食、成分（豬、牛、蛋、奶、花生…）是依店名與餐名的推測；有過敏或宗教飲食需求請以店家說明為準。
- 「穆斯林友善」只排除含豬肉與酒的品項，**不等於清真認證**；「僅清真認證／素食」只會選台灣清真推廣中心列出的穆斯林餐廳與素食品項。台大膳委會另有「穆斯林友善餐廳」地圖：<https://meals.ntu.edu.tw/board/detail/sn/2107>。
- 自助餐以一盤約 400 g（18 元/100 g）估 75 元，實際依取菜量而定。
