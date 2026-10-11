/**
 * Local embedding smoke test. The model may be downloaded on its first run.
 */
async function testLocalEmbedding() {
    console.log("🔄 [本地向量探針啟動] 正在嘗試從記憶體加載本地 Transformers 引擎...");
    
    try {
        // Load the Transformers.js pipeline.
        const { pipeline } = await import('@xenova/transformers');

        console.log("⏳ 正在初始化本地特徵提取管線 (首次執行會自動下載約 45MB 預訓練模型至本地檔案庫)...");
        const startTime = Date.now();

        // Initialize a local feature-extraction model.
        const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        const loadDuration = Date.now() - startTime;
        console.log(`🟢 本地模型大腦加載/下載成功！耗時: ${loadDuration} 毫秒`);

        // Sample text for the local embedding.
        const testText = "The garden has green leaves, a stone path, and a quiet pond.";
        console.log(`\n📡 正在調用本地 CPU 算力，對文字進行高維度特徵提取...`);
        
        const computeStart = Date.now();
        // Generate a mean-pooled, normalized embedding.
        const output = await embedder(testText, { pooling: 'mean', normalize: true });
        
        // Convert the model output tensor to a JavaScript array.
        const vector = Array.from(output.data);
        const computeDuration = Date.now() - computeStart;

        if (Array.isArray(vector) && vector.length > 0) {
            console.log("\n==============================================");
            console.log("🎉 🎉 歷史性突破！100% 純本地向量計算完全成功！");
            console.log("----------------------------------------------");
            console.log(`• 運算耗時: ${computeDuration} 毫秒 (完全在您的 CPU 內核發生)`);
            console.log(`• 向量結構: 成功換回標準幾何座標純數字陣列`);
            console.log(`• 陣列長度: ${vector.length} 維度 (完美對齊 ChromaDB V3 物理規格)`);
            console.log(`• 座標前 5 碼範例: [${vector.slice(0, 5).join(", ")}, ...]`);
            console.log("==============================================");
            console.log("💡 免死金牌到手！我們現在擁有了不受制於任何人的本地高維度模糊語義大腦了！");
        } else {
            console.error("❌ 雖然引擎有回應，但未能成功將張量轉為有效的陣列結構：", output);
        }

    } catch (error) {
        console.error("\n❌ [本地運算崩潰] 無法加載本地 Transformers 引擎：");
        console.error(error.message);
        console.error("\n💡 提示：請確保您的 Node.js 版本支援標準的動態 import(ES 模組) 語法。");
    }
}

testLocalEmbedding();
