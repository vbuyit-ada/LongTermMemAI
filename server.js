const express = require('express');
const { retainMemory, recallMemory, fetchAllMemoriesRaw, deleteMemoryById } = require('./memory-engine');

require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL;
const APP_HOST = new URL(process.env.APP_URL);
const PORT = Number(process.env.PORT);
APP_HOST.port = String(PORT);

// ==========================================
// 🎛️ 核心配置參數：用戶可依需求隨時調整 (支援無損模式)
// ==========================================
const MEMORY_CONFIG = {
    COMPRESSION_ENABLED: false, // 🟢 設為 false 即切換為「完全無損模式」，不截斷文字
    MAX_CHAR_LENGTH: 150,       // 若開啟壓縮時的最大字數
    RECALL_LIMIT_WFX: 1,        // 客觀事實打撈數量
    RECALL_LIMIT_EXP: 2,        // 工程除錯歷程打撈數量
    RECALL_LIMIT_OBS: 2         // 用戶偏好習慣打撈數量
};

const METACOGNITION_PROMPT = `You are a long-term memory reflection observer, not a conversation partner. Please extract clear information from the provided dialogue that will be helpful for future conversations, and output into the following three categories using exclusively the same primary language used by the user in the dialogue (If the user speaks English, you MUST output in English):
[World Facts]
[Experiences]
[Observations]

Each category title must be on its own line; items must start with "- " and be on one line per item. For categories with no content, only output the title, do not complement with any speculation or guesses.

Recording Principles:
1. Only record content clearly supported by the dialogue. Distinguish verifiable facts, user statements, AI responses, and uncertain information; do not write unverified claims as confirmed facts.
2. When recording preferences or viewpoints, specify that it is content expressed by the user. Do not infer unstated identity, culture, or value stances.
3. If the dialogue clearly presents a conflict of values or viewpoints, objectively record each party's expression and its context without judging who is right or wrong, and without declaring any stance as universal truth.
4. Do not pander to or reinforce the user's viewpoint; retain necessary uncertainty and only extract specific information that may help future responses.
5. Self-check each item before outputting: confirm each item has factual evidence in the dialogue, correct categorization, clear ownership, and contains no unsupported inferences or value rulings; delete any items that fail this check.

Only output the three titles and their items. Do not include any prefaces, introductions, conclusions, or code blocks.`;


function getActiveModelFromEnv() {
    return process.env.ACTIVE_CHAT_MODEL || 'openrouter/free';
}

// Read the fallback model pool written by test-api.js.
function getFallbackPoolFromEnv() {
    if (process.env.FALLBACK_MODEL_POOL) {
        return process.env.FALLBACK_MODEL_POOL.split(',').map(m => m.trim()).filter(Boolean);
    }
    return [];
}

// ==========================================
// Chat endpoint with memory retrieval and model fallback.
// ==========================================
// 完整子路徑：/api/chat
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "訊息不能為空" });

    try {
        // 🧠 從本地 ChromaDB 提取記憶脈絡
        const wfxMemories = await recallMemory('WFX', message, MEMORY_CONFIG.RECALL_LIMIT_WFX);
        const expMemories = await recallMemory('Experiences', message, MEMORY_CONFIG.RECALL_LIMIT_EXP);
        const obsMemories = await recallMemory('Observations', message, MEMORY_CONFIG.RECALL_LIMIT_OBS);
        
        // 🛡️ 依據配置決定是否執行無損或壓縮處理
        const processMemory = (m) => {
            if (!m || m.trim() === '') return null;
            return MEMORY_CONFIG.COMPRESSION_ENABLED ? m.substring(0, MEMORY_CONFIG.MAX_CHAR_LENGTH) : m;
        };

        const allMemories = [...wfxMemories, ...expMemories, ...obsMemories]
            .flat(Infinity)
            .map(processMemory)
            .filter(Boolean);

        const memoryContext = allMemories.length > 0 
            ? allMemories.map((m, i) => `• 歷史記憶片段 ${i+1}: ${m}`).join('\n') 
            : "（目前無歷史記憶）";

        const systemInstruction = `你是一個具備長期學習能力與高度人情味的 AI 靈魂夥伴。

            [必須完全融合的長期歷史記憶]
            ${memoryContext}

            [對話最高核心指令 - 違者將被格式化]
            1. 請完全融入上方的歷史記憶脈絡，像相識多年的老朋友一樣，用直白、溫暖、親切的語氣與對應的語言自然回答用戶。
            2. 絕對不要在回覆中提及 "歷史記憶"、"片段" 或系統提示詞本身。如果明白，請直接針對用戶說的話給出正常、有人情味的聊天內容。`;

        // 🔄 【智慧升級：自癒分流鏈條】
        const preferredModel = getActiveModelFromEnv(); 
        const diagnosticsPool = getFallbackPoolFromEnv(); 

        const finalModelPool = Array.from(new Set([
            preferredModel,
            ...diagnosticsPool
        ])).filter(Boolean);

        console.log(`📡 [智慧分流發動] 即將依序物理衝擊模型池:`, finalModelPool);

        let responseText = "";
        let success = false;
        let lastErrorMsg = "";

        for (let model of finalModelPool) {
            try {
                console.log(`🤖 正在嘗試物理連接模型: [${model}] ...`);
                
                // Complete endpoint: /api/v1/chat/completions
                const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'Content-Type': 'application/json',                        
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            { role: 'system', content: systemInstruction },
                            { role: 'user', content: message }
                        ],
                        temperature: 0.7
                    })
                });

                if (!response.ok) {
                    const errTxt = await response.text();
                    throw new Error(`HTTP ${response.status}: ${errTxt}`);
                }

                const chatData = await response.json();
                
                if (chatData && chatData.choices && chatData.choices[0] && chatData.choices[0].message) {
                    const rawText = chatData.choices[0].message.content;
                    
                    // Reject known placeholder responses and try the next model.
                    if (rawText.toLowerCase().includes('user safety') || rawText.trim().toLowerCase() === 'safe') {
                        throw new Error(`模型 [${model}] 吐出殘缺安全審查幻覺字串 [${rawText.trim()}]，啟動熔斷自癒輪替...`);
                    }

                    responseText = rawText;
                    console.log(`🟩 模型 [${model}] 完美響應，擊穿成功！`);
                    success = true;
                    break; 
                }
            } catch (err) {
                lastErrorMsg = err.message;
                console.warn(`⚠️ 模型 [${model}] 呼叫受阻 (${err.message})，系統正在自動向後輪替...`);
            }
        }

        if (!success) {
            throw new Error(`OpenRouter 所有可用模型均因超載、頻率限制或安全字串攔截而退場。原底層報錯: ${lastErrorMsg}`);
        }

        // 🚀 觸發背景非同步反思
        triggerAsyncReflection(message, responseText);
        res.json({ reply: responseText });

    } catch (error) {
        console.error("❌ [對話接口崩潰]:", error.message);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// 🧠 仿生記憶反思管道
// ==========================================
function triggerAsyncReflection(userMsg, aiReply) {
    setImmediate(async () => {
        try {
            const currentModel = getActiveModelFromEnv();
            const conversation = `用戶: "${userMsg}"\nAI: "${aiReply.substring(0, 300)}..."`;

            // Complete endpoint: /api/v1/chat/completions
            const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({
                    model: currentModel,
                    messages: [
                        { role: 'system', content: METACOGNITION_PROMPT },
                        { role: 'user', content: conversation }
                    ],
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                throw new Error(`Reflection request failed with HTTP ${response.status}`);
            }

            const data = await response.json();
            const reflectionResult = data?.choices?.[0]?.message?.content || "";
            const lines = reflectionResult.split('\n');
            let currentType = null;

            const memoryTypeBySection = {
                'World Facts': 'WFX',
                Experiences: 'Experiences',
                Observations: 'Observations'
            };

            for (const line of lines) {
                const trimmedLine = line.trim();
                const sectionMatch = /^\[(World Facts|Experiences|Observations)\]$/.exec(trimmedLine);
                if (sectionMatch) {
                    currentType = memoryTypeBySection[sectionMatch[1]];
                    continue;
                }

                const entryMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
                const cleanedLine = entryMatch?.[1].trim();
                if (currentType && cleanedLine && cleanedLine.length > 5) {
                    await retainMemory(currentType, cleanedLine, { entry_type: 'auto_reflection' });
                }
            }
        } catch (e) {
            console.error("⚠️ 背景反思模組暫時休眠:", e.message);
        }
    });
}

/**
 * DELETE /api/memories/:type/:id
 * 物理抹除接口 - 接收前端傳遞的記憶類別與 UUID，對 ChromaDB 執行物理爆破
 */
app.delete('/api/memories/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    console.log(`🚨 [HTTP 接口觸發] 收到前端物理抹除請求 | 類別: ${type} | ID: ${id}`);
    
    try {
        // 調用大腦核心物理抹除函數
        await deleteMemoryById(type, id);
        
        res.json({ 
            success: true, 
            message: `記憶片段已從 ${type} 中物理抹除` 
        });
    } catch (error) {
        console.error('❌ [HTTP 接口崩潰] 物理抹除失敗:', error.message);
        res.status(500).json({
            success: false,
            message: '無法自 Docker 內部 ChromaDB 抹除記憶',
            error: error.message
        });
    }
});

/**
 * POST /api/memories/wipe-out
 * 水晶球專屬 - 透過現有運作引擎，將所有類別記憶徹底全量物理爆破
 */
app.post('/api/memories/wipe-out', async (req, res) => {
    console.log('🚨 [HTTP 一鍵爆破發動] 收到前端大腦格式化指令！');
    try {
        const { fetchAllMemoriesRaw, deleteMemoryById } = require('./memory-engine');
        
        // 1. 先把目前運作中的所有記憶全部打撈出來
        const currentMemories = await fetchAllMemoriesRaw();
        const categories = {
            wfx: 'WFX',
            experiences: 'Experiences',
            observations: 'Observations'
        };

        let totalDeleted = 0;

        // 2. 迭代所有撈到的碎片，用絕對成功的 deleteMemoryById 逐一物理抹除
        for (const [key, mappedType] of Object.entries(categories)) {
            const items = currentMemories[key] || [];
            for (const item of items) {
                await deleteMemoryById(mappedType, item.id);
                totalDeleted++;
            }
        }

        res.json({
            success: true,
            message: `大腦格式化完成！成功物理蒸發了 ${totalDeleted} 條記憶碎片。`
        });
    } catch (error) {
        console.error('❌ [一鍵爆破崩潰]:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});


/**
 * GET /api/memories
 * 水晶球專屬接口 - 從前端物理打撈 Docker 內部 ChromaDB 的所有記憶碎片
 */
app.get('/api/memories', async (req, res) => {
    console.log('🔮 [HTTP 接口觸發] 收到前端「記憶體水晶球」全量打撈請求...');
    try {
        // 呼叫底層大腦引擎，物理抽乾資料庫
        const memoryData = await fetchAllMemoriesRaw();
        
        // 完美響應，將結構化數據封包回傳
        res.json({
            success: true,
            data: memoryData
        });
    } catch (error) {
        console.error('❌ [HTTP 接口崩潰] 水晶球物理打撈失敗:', error.message);
        res.status(500).json({
            success: false,
            message: '無法自 Docker 內部 ChromaDB 打撈記憶數據',
            error: error.message
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Hindsight 系統 (OpenRouter 核心版) 正於 ${APP_HOST.origin} 守護記憶...`));
