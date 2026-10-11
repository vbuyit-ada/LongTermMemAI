document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refreshBtn');

    // 物理執行記憶打撈的核心函數
    async function fetchAndRenderMemories() {
        refreshBtn.innerText = '正在物理抽乾資料庫...';
        refreshBtn.disabled = true;

        try {
            const response = await fetch('/api/memories');
            const result = await response.json();

            if (!result.success) {
                throw new Error(result.message || '打撈失敗');
            }

            const memoryBall = result.data;
            const categories = ['wfx', 'experiences', 'observations'];

            categories.forEach(category => {
                const listContainer = document.getElementById(`list-${category}`);
                const countBadge = document.getElementById(`count-${category}`);
                const items = memoryBall[category] || [];

                // 更新數量計數器
                countBadge.innerText = items.length;

                // 若該類別沒有任何碎片，顯示空白提示
                if (items.length === 0) {
                    listContainer.innerHTML = '<div class="status-msg">（當前無儲存的記憶碎片）</div>';
                    return;
                }

                // 渲染記憶體卡片，按時間戳倒序排列
                const sortedItems = [...items].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                listContainer.innerHTML = sortedItems.map(item => {
                    const localTime = item.timestamp ? new Date(item.timestamp).toLocaleString() : '未知時間';
                    return `
                        <div class="memory-card">
                            <button class="btn-delete" data-category="${category}" data-id="${item.id}" title="物理抹除這條記憶">❌</button>
                            <p class="memory-text">${escapeHtml(item.text)}</p>
                            <div class="memory-meta">
                                <span>🆔 ${item.id}</span>
                                <span>📅 ${localTime}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            });

        } catch (error) {
            console.error('❌ [前端渲染潰退]:', error);
            alert(`無法成功監控記憶體，錯誤原因: ${error.message}`);
        } finally {
            refreshBtn.innerText = '物理重新整理打撈';
            refreshBtn.disabled = false;
        }
    }

    // 全局監聽刪除按鈕點擊 (事件代理)
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.classList.contains('btn-delete')) {
            const button = e.target;
            const category = button.getAttribute('data-category');
            const id = button.getAttribute('data-id');

            // 對齊後端的大腦類別識別標籤映射 (WFX 必須轉為大寫，Experiences / Observations 首字母大寫)
            const typeMapping = {
                'wfx': 'WFX',
                'experiences': 'Experiences',
                'observations': 'Observations'
            };
            const mappedType = typeMapping[category];

            if (confirm(`⚠️ 警告：即將從 Docker 內部的 ChromaDB 中「物理爆破」這條記憶碎片！\n此動作將不可逆，確定執行？`)) {
                button.innerText = '⏳';
                button.disabled = true;

                try {
                    const response = await fetch(`/api/memories/${mappedType}/${id}`, {
                        method: 'DELETE'
                    });
                    const result = await response.json();

                    if (result.success) {
                        // 爆破成功，重新整理打撈最新狀態
                        await fetchAndRenderMemories();
                    } else {
                        throw new Error(result.message || '後端爆破失敗');
                    }
                } catch (err) {
                    alert(`物理爆破受阻: ${err.message}`);
                    button.innerText = '❌';
                    button.disabled = false;
                }
            }
        }
    });

    // 防止 XSS 攻擊的安全防禦過濾器
    function escapeHtml(string) {
        return String(string).replace(/[&<>"']/g, function (s) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;'
            }[s];
        });
    }

    const wipeBtn = document.getElementById('wipeBtn');
    if (wipeBtn) {
        wipeBtn.addEventListener('click', async () => {
            if (confirm('☠️ 終極警告 ☠️\n這將透過現有鏈路，將 Docker 內部的 WFX、Experiences、Observations 所有記憶徹底粉碎！\n此操作完全不可逆，AI 將徹底忘記你是誰。確定執行？')) {
                wipeBtn.innerText = '💥 正在執行記憶體核心爆破...';
                wipeBtn.disabled = true;
                try {
                    const response = await fetch('/api/memories/wipe-out', { method: 'POST' });
                    const result = await response.json();
                    if (result.success) {
                        alert(result.message);
                        location.reload(); // 重新整理網頁，見證純白大腦
                    } else {
                        throw new Error(result.error);
                    }
                } catch (err) {
                    alert(`爆破失敗: ${err.message}`);
                    wipeBtn.innerText = '🚨 一鍵格式化大腦';
                    wipeBtn.disabled = false;
                }
            }
        });
    }

    // 綁定手動重新整理按鈕事件
    refreshBtn.addEventListener('click', fetchAndRenderMemories);

    // 頁面初次載入時自動打撈
    fetchAndRenderMemories();
});
