require('dotenv').config();

const CHROMA_BASE_URL = process.env.CHROMA_BASE_URL;

/** Test the configured ChromaDB v2 heartbeat endpoint. */
async function testChromaDirectAPI() {
    console.log("🔄 Testing the configured ChromaDB endpoint...");
    
    // Request the ChromaDB heartbeat endpoint.
    const url = `${CHROMA_BASE_URL}/heartbeat`;

    try {
        const startTime = Date.now();
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        const duration = Date.now() - startTime;

        if (!response.ok) {
            throw new Error(`HTTP 錯誤！狀態碼: ${response.status} | 訊息: ${response.statusText}`);
        }

        // Read the heartbeat response.
        const data = await response.json();

        console.log("\n==============================================");
        console.log("🎉 🎉 歷史性突破！純 HTTP 直連 Docker 成功！");
        console.log("----------------------------------------------");
        console.log(`• 通訊耗時: ${duration} 毫秒 (毫秒級反應)`);
        console.log(`• Docker 核心回應內容:`, data);
        console.log("==============================================");
        console.log("💡 這代表 Docker 端的 ChromaDB 100% 暢通，而且完全不需要任何 SDK 的干預！");

    } catch (error) {
        console.error("\n❌ [API 通訊癱瘓] 物理連接本地 Docker 失敗：");
        console.error(error.message);
        console.error("\n🩺 檢查指南：請確認您的管理員終端機裡，ChromaDB 容器是否還處於 Up 狀態？(可執行 docker ps -a 核對)");
    }
}

testChromaDirectAPI();
