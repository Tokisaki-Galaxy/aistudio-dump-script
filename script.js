// ==UserScript==
// @name         AI Studio Chat Exporter (Auto-Scroll & JSON)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  从 aistudio.google.com 提取完整聊天记录，支持自动滚动加载虚拟列表，精准清洗 "Model" 杂项与思考过程。
// @author       Tokisaki Galaxy
// @match        https://aistudio.google.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 配置参数
    const CONFIG = {
        scrollDelay: 1200, // 滚动后的等待时间(ms)，网速慢可适当调大
        scrollStepPercent: 0.8, // 每次滚动屏幕高度的比例
    };

    let isExporting = false;

    // 创建悬浮按钮
    function createExportButton() {
        if (document.getElementById('ai-studio-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'ai-studio-export-btn';
        btn.innerText = '导出 JSON';
        Object.assign(btn.style, {
            position: 'fixed',
            top: '10px',
            right: '100px',
            zIndex: '9999',
            padding: '8px 12px',
            backgroundColor: '#1a73e8',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            fontWeight: 'bold',
            fontSize: '14px',
            transition: 'background-color 0.3s'
        });

        btn.onmouseover = () => btn.style.backgroundColor = '#1558b0';
        btn.onmouseout = () => btn.style.backgroundColor = isExporting ? '#999' : '#1a73e8';

        btn.onclick = startExportProcess;
        document.body.appendChild(btn);
    }

    // 更新按钮状态
    function updateButtonState(text, disabled = false) {
        const btn = document.getElementById('ai-studio-export-btn');
        if (btn) {
            btn.innerText = text;
            btn.disabled = disabled;
            btn.style.backgroundColor = disabled ? '#999' : '#1a73e8';
            btn.style.cursor = disabled ? 'wait' : 'pointer';
        }
    }

    // 等待函数
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // 获取 System Instruction
    function getSystemInstruction() {
        const sysElement = document.querySelector('ms-system-instruction-editor textarea') ||
                           document.querySelector('[aria-label="System Instructions"]');
        return sysElement ? (sysElement.value || sysElement.innerText).trim() : "";
    }

    // 核心：清洗单个对话节点的 HTML 内容
    function extractCleanText(turnElement) {
        // 1. 找到内容容器，通常在 .turn-content 下
        const contentDiv = turnElement.querySelector('.turn-content');
        if (!contentDiv) return null;

        // 克隆节点操作，避免影响页面
        const clone = contentDiv.cloneNode(true);

        // --- 移除列表 ---

        // 2. 移除 "Model" / "User" 这样的头部标签 (修复只显示 "Model" 的问题)
        clone.querySelectorAll('.author-label').forEach(el => el.remove());

        // 3. 移除思考过程 (ms-thought-chunk)
        clone.querySelectorAll('ms-thought-chunk').forEach(el => el.remove());

        // 4. 移除操作栏 (编辑、重试、复制等按钮)
        clone.querySelectorAll('.actions-container').forEach(el => el.remove());
        clone.querySelectorAll('button').forEach(el => el.remove());

        // 5. 移除展开思考的提示文案
        clone.querySelectorAll('.thought-collapsed-text, .thought-panel-footer').forEach(el => el.remove());

        // 获取纯文本
        let text = clone.innerText.trim();

        // 简单校验：如果清洗后只剩空字符，或者是加载占位符，视为无效
        if (!text) return null;

        return text;
    }

    // 自动滚动并抓取逻辑
    async function startExportProcess() {
        if (isExporting) return;
        isExporting = true;

        const container = document.querySelector('ms-autoscroll-container');
        if (!container) {
            alert('未找到聊天滚动区域，请确认当前在对话页面。');
            isExporting = false;
            return;
        }

        // 存储所有对话，使用 ID 作为 Key 进行去重
        // Map 会按照插入顺序保持，但由于我们可能有乱序插入，最后需按 DOM 顺序整理
        const collectedMessages = new Map();

        updateButtonState('准备开始...');

        // 1. 记录当前滚动位置以便恢复（可选，但通常我们最后会刷新）
        const initialScrollTop = container.scrollTop;

        // 2. 滚动到最顶部，开始遍历
        container.scrollTop = 0;
        await sleep(1000);

        let previousScrollTop = -1;
        let noProgressCount = 0;

        // 循环滚动直到到底
        while (true) {
            // 抓取当前视口可见的对话
            const turns = document.querySelectorAll('ms-chat-turn');
            let newItemsCount = 0;

            turns.forEach(turn => {
                const turnId = turn.id; // 必须有 ID，例如 turn-xxxx
                if (!turnId) return;

                // 判断角色
                let role = 'user';
                // 检查是否为模型 (类名或属性判断)
                if (turn.querySelector('.model-prompt-container') || turn.getAttribute('data-turn-role') === 'Model') {
                    role = 'assistant';
                }

                // 提取文本
                const text = extractCleanText(turn);

                // 只有当提取出有效文本，且该 ID 未被记录过，才保存
                // 或者：如果之前记录的是无效的/不完整的，可以用新的覆盖
                if (text) {
                    if (!collectedMessages.has(turnId)) {
                        newItemsCount++;
                    }
                    collectedMessages.set(turnId, {
                        role: role,
                        content: text,
                        domIndex: Array.from(turn.parentNode.children).indexOf(turn) // 记录 DOM 索引辅助排序
                    });
                }
            });

            // 计算进度
            const progress = Math.min(99, Math.round((container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100));
            updateButtonState(`正在抓取... ${progress}%`);

            // 检查是否到底
            // 容差 50px
            if (Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 50) {
                break;
            }

            // 如果连续多次滚动位置没变（可能到底了但高度计算误差），也退出
            if (container.scrollTop === previousScrollTop) {
                noProgressCount++;
                if (noProgressCount > 2) break;
            } else {
                noProgressCount = 0;
            }

            previousScrollTop = container.scrollTop;

            // 向下滚动一屏的一定比例
            container.scrollTop += container.clientHeight * CONFIG.scrollStepPercent;

            // 等待渲染
            await sleep(CONFIG.scrollDelay);
        }

        updateButtonState('整理数据...');

        // 3. 整理最终数据
        // 将 Map 转为 Array
        let finalMessages = Array.from(collectedMessages.values());

        // 理论上我们从上往下滚，顺序是对的。
        // 但为了保险，如果能获取到 turn 的 DOM 顺序索引最好，或者依赖 Map 的插入顺序。
        // 这里不做复杂排序，通常从上往下滚动的 Map 顺序即为正确顺序。

        const exportData = {
            system_instruction: getSystemInstruction(),
            messages: finalMessages.map(m => ({
                role: m.role,
                content: m.content
            }))
        };

        // 4. 导出文件
        downloadJson(exportData);

        updateButtonState('导出 JSON', false);
        isExporting = false;
    }

    // 下载 JSON
    function downloadJson(data) {
        // 生成文件名：使用当前时间或对话标题
        const titleElement = document.querySelector('.page-title h1');
        const titleName = titleElement ? titleElement.innerText.replace(/[\/\\?%*:|"<>]/g, '-') : 'aistudio_export';
        const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const fileName = `${titleName}_${dateStr}.json`;

        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // 初始化监听
    function init() {
        // 观察 DOM 变化，防止按钮在路由跳转后消失
        const observer = new MutationObserver(() => {
            createExportButton();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        createExportButton();
    }

    window.addEventListener('load', init);
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    }

})();
