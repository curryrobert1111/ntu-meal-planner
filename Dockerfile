# LINE Bot 用的容器設定（Google Cloud Run 會用這個檔案建置）
# 只放 bot 需要的檔案：linebot/ 與網站共用的 js/data.js、js/planner.js
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY linebot/package.json linebot/
RUN cd linebot && npm install --omit=dev --no-audit --no-fund
COPY js/data.js js/planner.js js/
COPY linebot/index.js linebot/
# Cloud Run 會給 PORT 環境變數（預設 8080），index.js 會自動讀取
CMD ["node", "linebot/index.js"]
