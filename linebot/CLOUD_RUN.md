# LINE Bot 部署到 Google Cloud Run

這份說明把 `linebot/` 部署到 Google Cloud Run，並接上 LINE 官方帳號。
完成後，每次 push 到 GitHub 的 `main` 分支，Cloud Run 都會自動重新建置、更新 bot。

> 介面上的按鈕名稱可能因語言或改版略有不同，下面同時列出中文和英文名稱。

---

## 0. 先了解費用與準備

| 項目 | 說明 |
|---|---|
| 需要什麼 | Google 帳號、一張信用卡（建立帳單帳戶用）、GitHub repo 的管理權限 |
| Cloud Run 免費額度（每月） | 200 萬次請求、180,000 vCPU 秒、360,000 GiB 秒。這個 bot 一個月大概用不到 1% |
| 可能產生的小額費用 | 存放容器映像檔的 Artifact Registry 只有 0.5 GB 免費，超過要收費；第 7 步會設定自動清舊版，避免超過 |
| 冷啟動 | 沒人用時會縮到 0 台，下一則訊息通常幾秒內就會回覆（Render 免費方案要等約 1 分鐘） |

**一定要做第 1 步的「預算提醒」**，超過金額會寄信通知你，避免意外扣款。

---

## 1. 建立 Google Cloud 專案、帳單帳戶與預算提醒

1. 打開 <https://console.cloud.google.com/>，用 Google 帳號登入。
2. 最上方的專案選單 →「新增專案（New Project）」。
   - 專案名稱：`ntu-meal-bot`（隨意）
   - 按「建立」，建好後切換到這個專案。
3. 左上選單 →「帳單（Billing）」→「連結帳單帳戶」。沒有帳單帳戶就照畫面建立，並填入信用卡。
4. 帳單 →「預算與快訊（Budgets & alerts）」→「建立預算」：
   - 範圍：選這個專案
   - 金額：例如 **NT$30**（或 US$1）
   - 快訊門檻：50%、90%、100%
   - 勾選「透過電子郵件通知帳單管理員」
   - 儲存

> 預算提醒只會寄信，不會自動停止服務。收到信時再到 Cloud Run 檢查用量。

---

## 2. 確認 repo 裡有 Dockerfile

專案根目錄已經有這兩個檔案（和 `index.html` 同一層），不用修改：

- `Dockerfile`：告訴 Cloud Run 怎麼建置 bot。只會放進 `linebot/`、`js/data.js`、`js/planner.js`。
- `.dockerignore`：排除圖片、網頁樣式等不需要的檔案。

確認這兩個檔案已經 push 到 GitHub 的 `main` 分支。

---

## 3. 建立 Cloud Run 服務（從 GitHub 持續部署）

1. 左上選單 →「Cloud Run」。第一次使用時，畫面會要求啟用 API，按「啟用」。
2. 按「部署容器（Deploy container）」→ 選「**從存放區持續部署**（Continuously deploy from a repository）」。
3. 按「**設定 Cloud Build**（Set up with Cloud Build）」：
   1. 存放區供應商：**GitHub** →「繼續」。
   2. 第一次會跳出 GitHub 授權，登入後安裝 **Google Cloud Build** 這個 GitHub App。
      可以只授權 `ntu-meal-planner` 這一個 repo。
   3. 存放區：選 `curryrobert1111/ntu-meal-planner`，勾選同意條款 →「下一步」。
   4. 分支：`^main$`
   5. 建構類型（Build Type）：選 **Dockerfile**
   6. 來源位置（Source location）：`/Dockerfile`
   7. 按「儲存」。
   - 如果畫面要求啟用 Cloud Build API、Artifact Registry API，按「啟用」。

4. 服務設定：

| 欄位 | 要填什麼 |
|---|---|
| 服務名稱 | `ntu-meal-bot` |
| 區域（Region） | **asia-east1（台灣）** |
| 驗證（Authentication） | **允許公開存取**（Allow unauthenticated invocations）。LINE 才能把訊息送進來 |
| 帳單（Billing） | **以要求為準**（Request-based）。只有處理訊息時才計算 CPU |
| 服務調度（Scaling） | 執行個體數下限 **0**、上限 **1** |
| 輸入（Ingress） | **全部**（All） |

5. 展開「**容器、磁碟區、網路、安全性**（Containers, Volumes, Networking, Security）」→「容器」分頁：
   - 容器通訊埠（Container port）：**8080**（預設值，不用改）
   - 記憶體：**512 MiB**；CPU：**1**
   - 要求逾時（Request timeout）：**60** 秒
   - 「**變數與密鑰**（Variables & Secrets）」→「新增變數」，加入三個：

| 名稱 | 值 |
|---|---|
| `LINE_CHANNEL_SECRET` | LINE Developers → Basic settings → Channel secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Messaging API → Channel access token (long-lived) |
| `WEB_URL` | `https://curryrobert1111.github.io/ntu-meal-planner/` |

   - 名稱要完全照抄（大小寫、底線）。值的前後不要有空白或引號。
   - **不要設 `PORT`**，Cloud Run 會自動提供。

6. 按「建立（Create）」。第一次建置約 2–5 分鐘。

---

## 4. 確認部署成功

1. 服務頁面最上方會出現網址，例如：
   `https://ntu-meal-bot-xxxxxxxxxx.asia-east1.run.app`
2. 用瀏覽器打開，看到 **`NTU meal bot is running.`** 就成功了。
3. 看不到的話，點「記錄（Logs）」分頁，對照第 9 節的常見問題。

---

## 5. 把 LINE 接到 Cloud Run

1. LINE Developers → 你的 channel →「Messaging API」→「Webhook settings」：
   - Webhook URL：`https://你的服務網址.run.app/webhook`（結尾一定要有 `/webhook`）
   - 按「Update」→「Verify」，顯示 **Success** 就成功了。
   - 打開「Use webhook」。
   - 「Webhook redelivery」保持**關閉**。
2. LINE Official Account Manager → 設定 →「回應設定」：
   - Webhook：開啟
   - 自動回應訊息：關閉

---

## 6. 測試

用手機傳這些訊息給官方帳號：

- `說明` → 指令列表
- `菜單` → 一週菜單
- `60元` → 今天 60 元左右的餐點
- `全素`、`不吃 牛肉`、`預算 1500` → 修改條件，再傳 `菜單`

---

## 7. 設定自動清舊映像檔（避免超過免費儲存空間）

每次 push 都會建一個新的映像檔，存在 Artifact Registry。免費空間只有 0.5 GB，要設定自動刪舊版：

1. 左上選單 →「Artifact Registry」→ 找到 Cloud Build 建立的存放區（通常叫 `cloud-run-source-deploy`）。
2. 點進去 →「編輯（Edit）」→「清除政策（Cleanup policies）」→「新增清除政策」：
   - 類型：**保留最新版本**（Keep most recent versions）
   - 保留數量：**2**
3. 儲存。

---

## 8. 之後怎麼更新 bot

- 改 `js/data.js`（餐點資料）、`js/planner.js` 或 `linebot/` 之後，push 到 `main` 即可，Cloud Run 會自動重新建置，約 2–5 分鐘後生效。
- 想讓「只改網頁」時不要重建 bot：
  Cloud Build →「觸發條件（Triggers）」→ 點進觸發條件 →「顯示包含和忽略的檔案篩選器」→「包含的檔案」填入：
  `linebot/**`、`js/data.js`、`js/planner.js`、`Dockerfile`
- 修改 LINE 鑰匙等變數：Cloud Run → 服務 →「編輯並部署新的修訂版本」→ 變數與密鑰。

---

## 9. 常見問題

| 狀況 | 原因與解法 |
|---|---|
| Verify 顯示 **403 Forbidden** | 第 3 步的「驗證」沒選「允許公開存取」。到服務的「安全性（Security）」分頁改成允許公開存取 |
| Verify 顯示 **404 Not Found** | Webhook URL 結尾少了 `/webhook`，或網址打錯 |
| Verify 顯示 **401** | `LINE_CHANNEL_SECRET` 填錯（或填成 access token） |
| 記錄出現「請先設定環境變數 …」 | 變數名稱打錯或沒填，回第 3 步檢查 |
| 記錄出現 `Cannot find module` | 根目錄的 `Dockerfile` 不見了，或建構類型沒選 Dockerfile |
| bot 收得到訊息但回不了（記錄出現 401／403 from api.line.me） | `LINE_CHANNEL_ACCESS_TOKEN` 錯誤或過期，到 LINE Developers 重新 Issue |
| 官方帳號回兩次 | 「自動回應訊息」沒關，到 Official Account Manager 關閉 |
| 使用者設定（預算、忌口）不見了 | 設定存在記憶體，執行個體縮到 0 或重新部署就會清空，這是目前設計的限制 |

---

## 10. 改用 Cloud Run 之後

- Render 上的服務可以暫停或刪除，cron-job.org 的定時叫醒也可以停用。
- LINE 只會把訊息送到一個 Webhook URL，所以兩邊不會重複回覆。

---

## 附錄：用指令部署（不連 GitHub 的做法）

想用指令一次部署，可以在 Google Cloud 主控台右上角打開 **Cloud Shell**，執行：

```bash
git clone https://github.com/curryrobert1111/ntu-meal-planner.git
cd ntu-meal-planner
gcloud run deploy ntu-meal-bot \
  --source . \
  --region asia-east1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --set-env-vars WEB_URL=https://curryrobert1111.github.io/ntu-meal-planner/ \
  --set-env-vars LINE_CHANNEL_SECRET=你的secret,LINE_CHANNEL_ACCESS_TOKEN=你的token
```

這個做法不會自動更新：每次改資料後，都要在 Cloud Shell 執行 `git pull` 再跑一次 `gcloud run deploy`。
