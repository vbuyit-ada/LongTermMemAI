require('dotenv').config();

// ChromaDB v2 API 基礎路徑與環境變數配置
const CHROMA_BASE_URL = process.env.CHROMA_BASE_URL;
const CHROMA_TENANT_UUID = process.env.CHROMA_TENANT_UUID;
const CHROMA_COLLECTION_PREFIX = process.env.CHROMA_COLLECTION_PREFIX || "hindsight_or_";

// 預設的記憶集合核心清單
const TARGET_CATEGORIES = ['wfx', 'experiences', 'observations'];

// 緩存本地嵌入大腦模型的實例
let localEmbedderInstance = null;

/**
 * 加載並緩存本地特徵提取模型（all-MiniLM-L6-v2）
 */
async function getLocalEmbedder() {
    if (localEmbedderInstance) return localEmbedderInstance;
    try {
        const { pipeline } = await import('@xenova/transformers');
        localEmbedderInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        return localEmbedderInstance;
    } catch (error) {
        console.error("❌ [Transformers 核心] 加載本地大腦失敗:", error.message);
        throw error;
    }
}

/**
 * 將原始文本轉換為歸一化的幾何向量（Embedding Vector）
 */
async function generateVector(text) {
    const embedder = await getLocalEmbedder();
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

/**
 * 確保預設資料庫存在，並獲取或建立指定類別的集合 ID
 */
async function getCollectionIdViaAPI(categoryName) {
    const databaseName = "default"; 

    // 在請求集合前，嘗試確保資料庫已實體建立
    try {
        // Trace URL: \({process.env.CHROMA_BASE_URL}/tenants/\){process.env.CHROMA_TENANT_UUID}/databases
        const createDbUrl = `${CHROMA_BASE_URL}/tenants/${CHROMA_TENANT_UUID}/databases`;
        await fetch(createDbUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: databaseName })
        });
    } catch (e) {
        // 忽略資料庫已存在的報錯，繼續向下執行
    }

    // 物理獲取或建立目標集合
    // Trace URL: \${process.env.CHROMA_BASE_URL}/tenants/\({process.env.CHROMA_TENANT_UUID}/databases/\){databaseName}/collections
    const url = `${CHROMA_BASE_URL}/tenants/${CHROMA_TENANT_UUID}/databases/${databaseName}/collections`;
    const collectionName = `${CHROMA_COLLECTION_PREFIX}${categoryName.toLowerCase()}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            configuration: null,
            get_or_create: true,
            metadata: null,
            name: collectionName,
            schema: null
        })
    });
    
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`無法建立/獲取集合 [${collectionName}] | HTTP 狀態碼: ${response.status} | 核心回應: ${errText}`);
    }
    
    const data = await response.json();
    return data.id; // 換回該集合在 Docker 內部的實體 UUID 安全通行證
}

/**
 * Hindsight RETAIN: 物理提取本地向量，並透過 v2 API 寫入 Docker 純向量儲存區
 */
async function retainMemory(memoryType, content, tags = {}) {
    console.log(`📡 [HTTP v2 API Engine] retainMemory 觸發！類型: [${memoryType}]`);
    try {
        const collectionId = await getCollectionIdViaAPI(memoryType);
        const pureNumericVector = await generateVector(content);
        const uniqueId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        // Trace URL: \${process.env.CHROMA_BASE_URL}/tenants/\({process.env.CHROMA_TENANT_UUID}/databases/default/collections/\){collectionId}/add
        const addUrl = `${CHROMA_BASE_URL}/tenants/${CHROMA_TENANT_UUID}/databases/default/collections/${collectionId}/add`;
        const response = await fetch(addUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ids: [uniqueId],
                embeddings: [pureNumericVector],
                metadatas: [{ ...tags, timestamp: new Date().toISOString() }],
                documents: [content]
            })
        });

        if (!response.ok) throw new Error(`HTTP 寫入失敗碼: ${response.status}`);

        console.log(`🧠 [Local API Retain 完美放行] Filed under [${memoryType}]: "${content.substring(0, 40)}..."`);
    } catch (error) {
        console.error(`❌ [Local API Retain 潰退] Failed for ${memoryType}:`, error.message);
    }
}

/**
 * Hindsight RECALL: 物理提取查詢向量，並透過 v2 API 在 Docker 內執行跨時空幾何比對
 */
async function recallMemory(memoryType, queryText, limit = 3, { throwOnError = false } = {}) {
    console.log(`📡 [HTTP v2 API Engine] recallMemory 觸發！類型: [${memoryType}]`);
    try {
        const collectionId = await getCollectionIdViaAPI(memoryType);
        const pureQueryVector = await generateVector(queryText);

        // Trace URL: \${process.env.CHROMA_BASE_URL}/tenants/\({process.env.CHROMA_TENANT_UUID}/databases/default/collections/\){collectionId}/query
        const queryUrl = `${CHROMA_BASE_URL}/tenants/${CHROMA_TENANT_UUID}/databases/default/collections/${collectionId}/query`;
        const response = await fetch(queryUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query_embeddings: [pureQueryVector],
                n_results: limit
            })
        });

        if (!response.ok) throw new Error(`HTTP 查詢失敗碼: ${response.status}`);

        const results = await response.json();
        
        if (!results || !Array.isArray(results.documents) || !Array.isArray(results.documents[0])) {
            if (throwOnError) throw new Error(`Invalid ChromaDB query response for ${memoryType}: missing documents`);
            return [];
        }

        const documents = results.documents[0];
        const ids = results.ids?.[0] || [];
        const metadatas = results.metadatas?.[0] || [];
        const distances = results.distances?.[0] || [];
        const memories = documents.flatMap((text, index) => text ? [{
            id: ids[index] || null,
            text,
            metadata: metadatas[index] || {},
            timestamp: metadatas[index]?.timestamp || null,
            distance: distances[index] ?? null
        }] : []);

        console.log(`🔍 [API Recall 診斷] 實體打撈到 ${memories.length} 條記憶碎片！`);
        return memories;
    } catch (error) {
        console.error(`❌ [Local API Recall 潰退] Failed for ${memoryType}:`, error.message);
        if (throwOnError) throw error;
        return [];
    }
}

/**
 * 水晶球專屬 - 全新物理全量打撈函數
 * 遍歷所有核心集合，透過 ChromaDB v2 POST /get 端點將其內部的原始文字與 Metadata 一併打包抽乾
 */
async function fetchAllMemoriesRaw() {
    console.log(`🔮 [水晶球大腦核心發動] 開始全量物理抽乾 Docker 內部記憶...`);
    const TARGET_CATEGORIES = ['wfx', 'experiences', 'observations'];
    const tenantUuid = process.env.CHROMA_TENANT_UUID;
    
    const memoryBall = {
        wfx: [],
        experiences: [],
        observations: []
    };

    try {
        for (const category of TARGET_CATEGORIES) {
            // 透過現有機制安全撈取該類別集合的 UUID 通行證
            const collectionId = await getCollectionIdViaAPI(category);

            // 使用 V2 標準的 POST /get 端點物理抽乾該集合內的所有數據
            // Trace URL: \${process.env.CHROMA_BASE_URL}/tenants/\({tenantUuid}/databases/default/collections/\){collectionId}/get
            const fetchUrl = `${CHROMA_BASE_URL}/tenants/${tenantUuid}/databases/default/collections/${collectionId}/get`;
            
            const response = await fetch(fetchUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}) // 傳入空物件以告知 ChromaDB 物理倒出全量數據
            });

            if (!response.ok) {
                console.warn(`⚠️ [水晶球打撈警告] 無法讀取集合 [${category}], 狀態碼: ${response.status}`);
                continue;
            }

            const chromaData = await response.json();

            // 若集合內存在數據，將其轉換為結構化的前端渲染格式
            if (chromaData && chromaData.ids && chromaData.ids.length > 0) {
                memoryBall[category] = chromaData.ids.map((id, index) => ({
                    id: id,
                    text: chromaData.documents?.[index] || '',
                    metadata: chromaData.metadatas?.[index] || {},
                    timestamp: chromaData.metadatas?.[index]?.timestamp || null
                }));
            }
        }
        return memoryBall;
    } catch (error) {
        console.error(`❌ [水晶球大腦核心崩潰] 物理抽乾失敗:`, error.message);
        throw error;
    }
}

/**
 * 水晶球專屬 - 全新物理抹除函數
 * 依據指定的記憶類別與 ID，物理擊穿 ChromaDB V2 進行徹底移除
 */
async function deleteMemoryById(memoryType, id) {
    console.log(`🗑️ [物理抹除發動] 準備從 ChromaDB 徹底移除碎屑 | 類型: [${memoryType}] | ID: [${id}]`);
    const tenantUuid = process.env.CHROMA_TENANT_UUID;
    
    try {
        // 透過現有機制安全撈取該類別集合的 UUID 通行證
        const collectionId = await getCollectionIdViaAPI(memoryType);

        // 使用 V2 標準的 POST /delete 端點物理抹除指定 ID
        // Trace URL: \${process.env.CHROMA_BASE_URL}/tenants/tenantUuid/databases/default/collections/{collectionId}/delete
        const deleteUrl = `${CHROMA_BASE_URL}/tenants/${tenantUuid}/databases/default/collections/${collectionId}/delete`;
        
        const response = await fetch(deleteUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [id] }) // 傳入目標 ID 陣列
        });

        if (!response.ok) {
            throw new Error(`HTTP 刪除失敗碼: ${response.status}`);
        }

        console.log(`🟩 [物理抹除成功] 記憶片段 [${id}] 已從 [${memoryType}] 徹底蒸發！`);
        return true;
    } catch (error) {
        console.error(`❌ [物理抹除潰退] 移除失敗:`, error.message);
        throw error;
    }
}


module.exports = { retainMemory, recallMemory, fetchAllMemoriesRaw, deleteMemoryById };
