const express = require('express');
const { retainMemory, recallMemory, fetchAllMemoriesRaw, deleteMemoryById } = require('./memory-engine');
const { isLikelyDuplicate } = require('./memory-deduplication');

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

const METACOGNITION_PROMPT = `You are a long-term memory reflection observer, not a conversation partner. Your job is to extract new information or update existing memories based on the current dialogue turn and the provided list of existing memories. 

You MUST output into the following three categories using exclusively the same primary language used by the user in the dialogue (If the user speaks English, you MUST output in English):
[World Facts]
[Experiences]
[Observations]

Each category title must be on its own line; items must start with "- " and be on one line per item. For categories with no new or modified content, only output the title—do not include placeholders, speculation, or guesses.

Memory Consolidation & Deduplication Principles:
1. Compare with Existing Memories: Before writing any item, check the "[Existing Long-Term Memories Related to This Topic]" list provided in the user prompt. 
2. Strict Deduplication: Do NOT extract a piece of information if it is already clearly recorded. If the user repeats something already known (e.g., repeating a hobby like basketball), skip it completely unless there is a fresh, significant update or change.
3. Anti-Fragmentation (Merge Rule): If an incoming fact updates an existing memory, write a single comprehensive consolidated item that replaces or extends the old one, rather than creating a secondary fragmented row.
4. Ignore Conversational Fluff: Do NOT record conversational pleasantries, polite greetings, or social expressions about the AI or the user (e.g., "AI expressed gladness to meet the user", "User said hi"). Only record meaningful long-term facts, experiences, or behavioral habits.
5. Evidence-Backed: Only record content clearly supported by the immediate dialogue. Distinguish user statements from verifiable facts. Do not pander to or reinforce the user's viewpoint.
6. Identity Anchoring Rule: When recording a fact or experience about the person chatting with you, ALWAYS refer to them strictly as "User" (e.g., write "- User's name is Ming", NOT "- Ming's name is Ming"). When recording a fact about yourself, always use "AI". Never use the user's actual name as the subject inside the memory record string.

Only output the three titles and their items. Do not include any prefaces, introductions, conclusions, or code blocks.`;

const fs = require('fs');
const path = require('path');

// Helper function to append telemetry insights to a localized log file
function writeTelemetryLog(type, model, usageData, errorMsg = null) {
    const logPath = path.join(__dirname, 'telemetry.log');
    const timestamp = new Date().toISOString();
    
    const logEntry = {
        timestamp,
        type, // 'CHAT' or 'REFLECTION'
        model,
        prompt_tokens: usageData?.prompt_tokens || 0,
        completion_tokens: usageData?.completion_tokens || 0,
        total_tokens: usageData?.total_tokens || 0,
        success: !errorMsg,
        error: errorMsg || undefined
    };

    fs.appendFile(logPath, JSON.stringify(logEntry) + '\n', (err) => {
        if (err) console.error('❌ Failed writing to telemetry.log:', err.message);
    });
}


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
// Complete endpoint: /api/chat
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "訊息不能為空" });

    try {
        // 🧠 從本地 ChromaDB 提取記憶脈絡
        const wfxMemories = await recallMemory('WFX', message, MEMORY_CONFIG.RECALL_LIMIT_WFX);
        const expMemories = await recallMemory('Experiences', message, MEMORY_CONFIG.RECALL_LIMIT_EXP);
        const obsMemories = await recallMemory('Observations', message, MEMORY_CONFIG.RECALL_LIMIT_OBS);
        
        const allMemories = [...wfxMemories, ...expMemories, ...obsMemories]
            .flat(Infinity)
            .filter(memory => memory && typeof memory.text === 'string' && memory.text.trim())
            .map(memory => ({
                ...memory,
                text: MEMORY_CONFIG.COMPRESSION_ENABLED
                    ? memory.text.substring(0, MEMORY_CONFIG.MAX_CHAR_LENGTH)
                    : memory.text
            }));

        const memoryContext = allMemories.length > 0 
            ? allMemories.map((m, i) => {
                const timeLabel = m.timestamp ? `[${m.timestamp} UTC] ` : '';
                return `• ${timeLabel}歷史記憶片段 ${i+1}: ${m.text}`;
              }).join('\n') 
            : "（目前無歷史記憶）";

        const systemInstruction = `你是一個具備長期學習能力與高度人情味的 AI 靈魂夥伴。

            [必須完全融合的長期歷史記憶]
            ${memoryContext}

            [對話最高核心指令 - 違者將被格式化]
            1. 請完全融入上方的歷史記憶脈絡，像相識多年的老朋友一樣，用直白、溫暖、親切的語氣自然回答用戶。
            2. 【語言鏡像原則】：你必須嚴格辨識用戶當前發送訊息的語言。如果用戶用英文說話，你必須完全使用英文回覆；如果用戶使用中文，你則使用中文回覆。絕對不可無視用戶的語言切換。
            3. 【時序優先原則】：歷史記憶片段前附帶有時間戳記欄位。如果不同記憶片段之間存在矛盾或資訊變更，請務必以時間戳記最新的紀錄為絕對依據。
            4. 絕對不要在回覆中提及 "歷史記憶"、"片段" 或系統提示詞本身。如果明白，請直接針對用戶說的話給出正常、有人情味的聊天內容。`;


        const preferredModel = getActiveModelFromEnv(); 
        const diagnosticsPool = getFallbackPoolFromEnv(); 

        // Extract and deduplicate unique models
        let finalModelPool = Array.from(new Set([
            preferredModel,
            ...diagnosticsPool
        ])).filter(Boolean);

        // 🛡️ Step 1: Cap the model pool attempts to a maximum of 2 to stop quota drainage
        const MAX_ATTEMPTS = 2;
        if (finalModelPool.length > MAX_ATTEMPTS) {
            console.log(`⚠️ Pool has ${finalModelPool.length} models. Capping down to the first ${MAX_ATTEMPTS} to protect limits.`);
            finalModelPool = finalModelPool.slice(0, MAX_ATTEMPTS);
        }

        console.log(`📡 [智慧分流發動] 即將依序嘗試安全模型池:`, finalModelPool);

        let responseText = "";
        let success = false;
        let lastErrorMsg = "";

        for (let model of finalModelPool) {
            try {
                console.log(`🤖 正在嘗試物理連接模型: [${model}] ...`);
                
                // Complete path check: /api/v1/chat/completions
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
                    
                    if (rawText.toLowerCase().includes('user safety') || rawText.trim().toLowerCase() === 'safe') {
                        throw new Error(`模型 [${model}] 吐出殘缺安全審查幻覺字串`);
                    }

                    responseText = rawText;
                    console.log(`🟩 模型 [${model}] 完美響應！`);
                    
                    // 🛡️ Step 2: Track token metrics to telemetry log file on success
                    writeTelemetryLog('CHAT', model, chatData.usage);
                    
                    success = true;
                    break; 
                }
            } catch (err) {
                lastErrorMsg = err.message;
                console.warn(`⚠️ 模型 [${model}] 呼叫受阻 (${err.message})`);
                // Log failed attempt details into telemetry log
                writeTelemetryLog('CHAT', model, null, err.message);
            }
        }

        if (!success) {
            throw new Error(`OpenRouter 可用模型已達安全限制上限或完全崩潰。底層錯誤: ${lastErrorMsg}`);
        }

        triggerAsyncReflection(message, responseText);
        res.json({ reply: responseText });

    } catch (error) {
        console.error("❌ [對話接口崩潰]:", error.message);
        res.status(500).json({ error: error.message });
    }
});


// ==========================================
// 🧠 仿生記憶反思管道 (智慧升級：注入既有記憶脈絡)
// ==========================================
function triggerAsyncReflection(userMsg, aiReply) {
    setImmediate(async () => {
        try {
            const currentModel = getActiveModelFromEnv();

            // 🔍 1. 反思前先從本地 ChromaDB 提取當前相關的所有記憶片段，以便進行排重與合併
            const existingWfx = await recallMemory('WFX', userMsg, 3);
            const existingExp = await recallMemory('Experiences', userMsg, 3);
            const existingObs = await recallMemory('Observations', userMsg, 3);

            const allExisting = [...existingWfx, ...existingExp, ...existingObs]
                .flat(Infinity)
                .filter(Boolean);

            // FIX: Inject timestamps into the background reflection sheet
            const existingMemoriesSheet = allExisting.length > 0
                ? allExisting.map((m, i) => {
                    const timeLabel = m.timestamp ? `[${m.timestamp} UTC] ` : '';
                    return `  • 已存片段 ${i+1}: ${timeLabel}${m.text}`;
                  }).join('\n')
                : "  （目前此主題無歷史既留紀錄）";


            // 📝 2. 組裝含有既有記憶比對清單的對話上下文中繼包
            const conversation = `[Existing Long-Term Memories Related to This Topic]\n${existingMemoriesSheet}\n\n[Current Dialogue Turn]\n用戶: "${userMsg}"\nAI: "${aiReply.substring(0, 300)}..."`;

            // Complete endpoint path: /api/v1/chat/completions
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
            
            // 🛡️ Step 2 保持運作：寫入背景反思量測日誌
            writeTelemetryLog('REFLECTION', currentModel, data?.usage);

            const reflectionResult = data?.choices?.[0]?.message?.content || "";
            const lines = reflectionResult.split('\n');
            let currentType = null;

            const memoryTypeBySection = {
                'World Facts': 'WFX',
                Experiences: 'Experiences',
                Observations: 'Observations'
            };

            // Use clean regex patterns without accidental escape characters
            for (const line of lines) {
                const trimmedLine = line.trim();
                const sectionMatch = /^\[(World Facts|Experiences|Observations)\]$/.exec(trimmedLine);
                if (sectionMatch) {
                    currentType = memoryTypeBySection[sectionMatch[1]];
                    continue;
                }

                const entryMatch = /^[-*]\s+(.+)$/.exec(trimmedLine);
                if (entryMatch) {
                    const cleanedLine = entryMatch[1].trim();
                    if (currentType && cleanedLine && cleanedLine.length > 5) {
                        const existingMemories = await recallMemory(currentType, cleanedLine, 10, {
                            throwOnError: true
                        });
                        const isDuplicate = existingMemories.some(existing =>
                            isLikelyDuplicate(cleanedLine, existing.text)
                        );

                        if (isDuplicate) {
                            console.log(`⏭️ Skipping likely duplicate memory in ${currentType}.`);
                            continue;
                        }

                        await retainMemory(currentType, cleanedLine, { entry_type: 'auto_reflection' });
                    }
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
