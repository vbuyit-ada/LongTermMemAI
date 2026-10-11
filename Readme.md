# LongTermMemAI

以 Express 提供的長期記憶聊天應用程式。伺服器透過 OpenRouter 產生聊天回覆，使用 ChromaDB v2 儲存及檢索記憶，並使用 `@xenova/transformers` 在本機產生文字 embedding。

本專案的長期記憶設計概念受到 [Hindsight](https://github.com/vectorize-io/hindsight) 啟發；本專案使用自己的程式碼與技術架構實作。

## 功能

- 網頁聊天介面，支援 Markdown 顯示及程式碼高亮。
- 以 OpenRouter 聊天完成 API 產生回覆，並依序嘗試設定的備援模型。
- 使用本機 `Xenova/all-MiniLM-L6-v2` 模型產生向量，將記憶儲存及檢索於 ChromaDB。
- 聊天成功後，在背景反思對話並嘗試儲存記憶。
- Crystal 記憶主控台可檢視、刪除單筆記憶或要求清除全部記憶。

## 🛠️ 近期重大架構優化進展 (Recent Progress)

為了徹底解決 Free-tier 模型的流量耗盡、記憶冗餘、以及多語言和身份錯亂問題，專案最近完成了以下四項核心底層升級：

1. **配額與分流熔斷保護 (Token Telemetry & Failover Throttling)**
   - 引入了本地自動化追蹤文件 `telemetry.log`，精準記錄每次對話（CHAT）與記憶反思（REFLECTION）所消耗的 Prompt、Completion 與 Total Tokens。
   - 限制了 `server.js` 中備援模型池（Failover Loop）的無休止嘗試。目前最高限制只嘗試 2 個模型，遇到崩潰或安全字串立即熔斷，防止單次對話瞬間燒光每日 50 次的 API 額度。

2. **雙層混合式記憶排重防線 (Dual-Layer Deduplication Guard)**
   - **語意層 Prompt 限制**：在 `METACOGNITION_PROMPT` 中新增原則，強制 AI 忽略問候語、社交客套話（Conversational Fluff），且重複提及已知興趣（如籃球、牛排）時不進行重寫。
   - **文字近似排重檢查（JavaScript Runtime Gate）**：寫入前會在同類別的 ChromaDB 集合中檢索最多 10 條候選記憶，忽略大小寫、標點及空白後，略過正規化文字相同或字元 bigram Dice 相似度至少 0.90 的條目。短於 20 字元的內容只做正規化完全比對；極性詞不同時不以模糊比對判定重複。這是盡力而為的文字近似檢查，不保證能識別所有語意重複；若檢索失敗，該條記憶不會寫入。

3. **人稱身份錨定與時間序列優先 (Identity Anchoring & Temporal Priority)**
   - **身份錨定原則**：修正了原本會生成「Ming 喜歡牛排」這種令人困惑的第三人稱幽靈 loops，強制 AI 將記憶主體統一規範為 `User`（用戶）與 `AI`（夥伴）。
   - **時序脈絡注入**：ChromaDB 查詢會回傳記憶文字及 metadata；聊天和反思上下文會在有時間戳時附上 ISO 時間並明確標示 `UTC`。模型會被提示優先考慮較新的相關記憶，但檢索結果有限，時間判斷仍屬模型行為，不保證自動解決所有衝突。

4. **動態語言鏡像感知 (Dynamic Language Mirroring)**
   - 移除了硬編碼的語言鎖定，在系統提示詞中植入【語言鏡像原則】。AI 不再受到漫長歷史上下文或初始提示詞的語言干擾，能夠 100% 靈敏地鏡像感知用戶當前發送訊息的語言（英文發問則英文回覆，中文發問則中文回覆）。

聊天提示中的記憶文字壓縮由 `server.js` 的 `MEMORY_CONFIG` 控制。預設 `COMPRESSION_ENABLED` 為 `false`；設為 `true` 時，僅將提供給聊天模型的每筆檢索記憶截斷至 `MAX_CHAR_LENGTH`（目前為 150 個 UTF-16 code units），不會改寫 ChromaDB 中儲存的原文。

## 专案档案

```text
LongTermMemAI/
├── .gitignore
├── Readme.md
├── memory-engine.js      # 本機 embedding 與 ChromaDB 記憶操作
├── memory-deduplication.js # 記憶文字近似排重
├── package.json          # 專案依賴
├── package-lock.json
├── server.js             # Express 伺服器、聊天與記憶管理 API
├── test-api.js           # 探測 OpenRouter 模型並更新備援模型設定
├── test-chroma-api.js    # 測試 ChromaDB heartbeat
├── test-hf.js            # 測試本機 Transformers.js embedding
├── test-memory-deduplication.js # 測試記憶近似排重
└── public/
    ├── index.html        # 聊天介面
    ├── crystal.html      # 記憶管理主控台
    └── crystal.js        # 主控台的記憶載入與管理操作
```

`.env` 是本機設定檔，請依下方說明自行建立；它和 `node_modules/` 均已列入 `.gitignore`，不會提交至 Git。

## 需求

- Node.js 18 或更新版本（需支援內建 `fetch`）。
- 可連線的 OpenRouter API。
- 可連線的 ChromaDB v2 服務。
- 首次使用 embedding 時可下載 `Xenova/all-MiniLM-L6-v2` 模型檔案。
- 瀏覽器需能載入聊天頁面使用的外部 CDN 資源。

## 設定

在本機建立 `.env` 並設定下列變數。不要將實際 API 金鑰或其他機密提交至 Git。

| 變數 | 用途 |
| --- | --- |
| `OPENROUTER_API_KEY` | OpenRouter API 金鑰。 |
| `OPENROUTER_BASE_URL` | OpenRouter API base URL，須包含 `/api/v1`。 |
| `CHROMA_BASE_URL` | ChromaDB API base URL，須包含 `/api/v2`。 |
| `APP_URL` | 應用程式主機網址，不含連接埠，例如 `http://localhost`。 |
| `PORT` | Express 伺服器監聽的連接埠。 |
| `ACTIVE_CHAT_MODEL` | 主要聊天模型；未設定時使用 `openrouter/free`。 |
| `FALLBACK_MODEL_POOL` | 逗號分隔的備援模型 ID；可留空。 |
| `CHROMA_TENANT_UUID` | ChromaDB tenant；未設定時使用程式內的預設值。 |
| `CHROMA_COLLECTION_PREFIX` | 集合名稱前綴；未設定時使用 `LongTermMemAI_or_`。 |

`OPENROUTER_BASE_URL` 和 `CHROMA_BASE_URL` 已包含 API 版本路徑；程式會再分別附加 `/chat/completions`、`/models` 或 ChromaDB 資源路徑。設定時不要省略或重複版本路徑。

## 安裝與啟動

```bash
npm install
node server.js
```

使用 `APP_URL` 和 `PORT` 設定的網址開啟聊天頁面。若設定為 `APP_URL=http://localhost`、`PORT=3100`，則可前往：

- 聊天頁面：`http://localhost:3100/`
- Crystal 記憶主控台：`http://localhost:3100/crystal.html`

結束伺服器時，在終端機按 `Ctrl+C`。

## 探測工具

以下是可手動執行的測試及探測腳本；本專案尚未設定完整的自動化測試套件：

```bash
# 測試記憶文字近似排重
node test-memory-deduplication.js

# 測試本機 embedding；首次執行可能下載模型
node test-hf.js

# 測試 CHROMA_BASE_URL 設定的 ChromaDB heartbeat
node test-chroma-api.js

# 查詢 OpenRouter 模型清單並更新 .env 中的模型設定
node test-api.js
```

`test-api.js` 會改寫 `.env` 中的 `ACTIVE_CHAT_MODEL` 與 `FALLBACK_MODEL_POOL`。它會從 OpenRouter `/models` 清單篩選模型；這不是用量監控或配額查詢工具。外部服務探測結果只反映執行當下狀況。

## 聊天與記憶流程

`POST /api/chat` 依序從 `WFX`、`Experiences` 和 `Observations` 集合檢索記憶，將文字、metadata 及可用的 UTC timestamp 提供給主要模型及備援模型。聊天回覆成功後，背景反思會再呼叫 OpenRouter，依 `[World Facts]`、`[Experiences]` 和 `[Observations]` 分類輸出，並嘗試將條目寫入 ChromaDB。寫入每筆反思記憶前，程式會在同一類別檢索最多 10 筆候選項目，套用文字近似排重檢查；若此檢查的 ChromaDB 查詢失敗，該次背景反思流程會中止，不會寫入該候選。此檢查不會刪除或合併已存在的記憶，也無法保證辨識跨類別重複或不同措辭的語意重複。背景反思不會阻塞聊天回應；若記憶引擎或反思失敗，伺服器會記錄錯誤。

記憶向量由本機 `@xenova/transformers` 套件產生；OpenRouter 用於聊天及背景反思，不用於產生 embedding。

## 應用程式 API

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| `POST` | `/api/chat` | 傳入 `{ "message": "..." }`，成功時回傳 `{ "reply": "..." }`。空訊息回傳 HTTP 400。 |
| `GET` | `/api/memories` | 回傳 `data` 物件，包含 `wfx`、`experiences`、`observations` 三個陣列。記憶項目包含 `id`、`text`、`metadata`、`timestamp`。 |
| `DELETE` | `/api/memories/:type/:id` | 刪除指定記憶。`:type` 為 `WFX`、`Experiences` 或 `Observations`。 |
| `POST` | `/api/memories/wipe-out` | 要求刪除三類集合中列出的所有記憶；此操作不可復原，失敗時可能只完成部分刪除。 |

目前聊天及記憶管理 API 沒有身分驗證或授權。請勿將伺服器暴露於不受信任的網路，尤其 `wipe-out` 可刪除記憶。

## ChromaDB v2 路徑

以下是相對於 `CHROMA_BASE_URL` 的路徑。程式使用的資料庫名稱為 `default`；tenant 預設值及集合前綴由 `memory-engine.js` 設定。

| 功能 | 方法 | 路徑 |
| --- | --- | --- |
| Heartbeat 探測 | `GET` | `/heartbeat` |
| 建立或確認資料庫 | `POST` | `/tenants/{tenant}/databases` |
| 建立或取得集合 | `POST` | `/tenants/{tenant}/databases/{database}/collections` |
| 寫入記憶 | `POST` | `/tenants/{tenant}/databases/{database}/collections/{collectionId}/add` |
| 查詢相似記憶 | `POST` | `/tenants/{tenant}/databases/{database}/collections/{collectionId}/query` |
| 讀取集合記憶 | `POST` | `/tenants/{tenant}/databases/{database}/collections/{collectionId}/get` |
| 刪除記憶 | `POST` | `/tenants/{tenant}/databases/{database}/collections/{collectionId}/delete` |

## 注意事項與未來發展規劃 (What's Next)

- 本專案目前沒有定義 `npm test` 或 build 指令。
- ChromaDB 的執行方式及 Docker 映像版本不由本專案固定。
- ChromaDB `/get` 操作會將各類別集合記憶載入主控台；資料量大時會增加回應及瀏覽器負擔。
- 聊天介面載入 Tailwind CSS、字型、Markdown 解析器及程式碼高亮等外部 CDN 資源。
- 最後希望可以在LongMemEval benchmark造行評分。

### 🚀 建議的下一步優化藍圖 (Proposed Future Roadmap)

1. **建立自動化評估基準（Evaluation Suite / LongMemEval 模擬）**
   - 撰寫一個獨立的 `test-longmemeval.js` 腳本，加載標準的多輪對話測試集，自動流式發送給 `/api/chat`，測試記憶在極長跨度下的留存、衝突處理與事實檢索準確率，為專案產出可量化的效能分數報告。

2. **打撈閾值與動態 K 值最佳化（Dynamic K-Nearest Recall Tuning）**
   - 目前 `RECALL_LIMIT` 是硬編碼的靜態數字。當資料庫增長到上千條記憶時，靜態打撈容易造成上下文污染。後續可研究引入基於相似度分數（Distance Score Threshold）的過濾機制，只有大於 0.6 相似度的核心記憶才允許注入 Prompt。

3. **內存快取層與資料庫異步批次寫入（In-Memory Telemetry Cache）**
   - 目前的 `telemetry.log` 採用每次對話直接物理 I/O `fs.appendFile` 寫入。在高併發情況下容易造成磁碟阻塞。未來可優化為內存緩衝區快取（In-Memory Cache Pool），定時或定量非同步批次沖刷（Flush）至磁碟。
