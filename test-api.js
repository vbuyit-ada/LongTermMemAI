const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL;
const envPath = path.join(__dirname, '.env');
const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey || apiKey.includes('YOUR_')) {
    console.error("❌ 錯誤: 請先在 .env 檔案中填入正確的 OPENROUTER_API_KEY！");
    process.exit(1);
}

// Set headers for OpenRouter API requests.
const requestHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function runDiagnostics() {
    console.log("\n🔄 正在連線 OpenRouter 進行香港直連配額與模型探測...\n");

    // Read account fields returned with the models response.
    try {
        const quotaRes = await fetch(`${OPENROUTER_BASE_URL}/models`, {
            method: 'GET',
            headers: requestHeaders
        });
        const quotaData = await quotaRes.json();
        
        if (quotaData && quotaData.data) {
            console.log("==========================================");
            console.log("📊 OpenRouter 金鑰實時狀態報告：");
            console.log("------------------------------------------");
            console.log(`• 帳戶權限: ${quotaData.data.is_free_tier ? "🟢 永久免費層" : "🟡 付費充值層"}`);
            console.log(`• 本日累計呼叫: ${quotaData.data.usage || 0} 次`);
            console.log(`• 本日累計消耗: ${quotaData.data.total_tokens || 0} Tokens`);
            console.log(`• 金鑰限制上限: ${quotaData.data.limit || "動態頻率監控中"}`);
            console.log("==========================================\n");
        } else {
            console.warn("⚠️ 無法讀取金鑰詳細指標，但連線已建立。\n");
        }
    } catch (err) {
        console.error("❌ 金鑰驗證失敗，請檢查網路連線或金鑰是否正確:", err.message);
    }

    // Fetch the current model catalog.
    try {
        const modelsRes = await fetch(`${OPENROUTER_BASE_URL}/models`, {
            method: 'GET',
            headers: requestHeaders
        });
        const modelsData = await modelsRes.json();
        
        if (modelsData && modelsData.data) {
            const liveFrees = modelsData.data
                .filter(m => m.id.includes(':free') || m.id === 'openrouter/free')
                .map(m => m.id);

            console.log("==========================================");
            console.log(`🔥 香港直連當前可用免費模型名單 (共 ${liveFrees.length} 個)：`);
            console.log("------------------------------------------");
            liveFrees.slice(0, 5).forEach((m, idx) => {
                console.log(`  [${idx + 1}] ${m}`);
            });
            if (liveFrees.length > 5) console.log(`  ... 以及其他 ${liveFrees.length - 5} 個免費模型`);
            console.log("==========================================");
            
            // Filter the live list using the configured allowlist and blocklist.
            const primaryModel = 'openrouter/free';
            
            // Include IDs containing one of these terms.
            const allowedKeywords = ['gemma', 'llama', 'liquid', 'nemotron', 'google', 'meta', 'nvidia'];
            
            // Exclude IDs containing any of these terms.
            const bannedKeywords = ['sante', 'fin', 'safety', 'note', 'qwen', 'deepseek', 'yi', 'glm'];

            let filteredPool = liveFrees.filter(modelId => {
                const lowerId = modelId.toLowerCase();
                // Require an allowed term and reject blocked terms.
                const isUniversal = allowedKeywords.some(kw => lowerId.includes(kw));
                const isBanned = bannedKeywords.some(kw => lowerId.includes(kw));
                return isUniversal && !isBanned;
            });

            // If fewer than three matches remain, fill from other non-blocked IDs.
            if (filteredPool.length < 3) {
                filteredPool = [...filteredPool, ...liveFrees].filter(m => {
                    const lowerM = m.toLowerCase();
                    return !bannedKeywords.some(kw => lowerM.includes(kw));
                });
            }

            // Use up to three IDs in the fallback pool.
            const top3UniversalModels = filteredPool.slice(0, 3).join(',');
            
            let lines = [];
            if (fs.existsSync(envPath)) {
                const envContent = fs.readFileSync(envPath, 'utf8');
                lines = envContent.split(/\r?\n/);
            }
            
            let foundPrimary = false;
            let foundPool = false;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('ACTIVE_CHAT_MODEL=')) {
                    lines[i] = `ACTIVE_CHAT_MODEL=${primaryModel}`;
                    foundPrimary = true;
                }
                if (lines[i].startsWith('FALLBACK_MODEL_POOL=')) {
                    lines[i] = `FALLBACK_MODEL_POOL=${top3UniversalModels}`;
                    foundPool = true;
                }
            }
            
            if (!foundPrimary) lines.push(`ACTIVE_CHAT_MODEL=${primaryModel}`);
            if (!foundPool) lines.push(`FALLBACK_MODEL_POOL=${top3UniversalModels}`);
            
            fs.writeFileSync(envPath, lines.filter(line => line.trim() !== '').join('\r\n') + '\r\n', 'utf8');
            
            console.log(`\n💾 智慧非大陸備援設定已同步至 .env：`);
            console.log(`  • 主控大腦: [ACTIVE_CHAT_MODEL=${primaryModel}]`);
            console.log(`  • 隔離後安全自癒池: [FALLBACK_MODEL_POOL=${top3UniversalModels}]`);

        }
    } catch (err) {
        console.error("❌ 無法獲取最新的免費模型名單:", err.message);
    }
}

runDiagnostics();
