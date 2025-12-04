// ==UserScript==
// @name         AI Studio Chat Exporter (Markdown & Code Block Support)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  导出 AI Studio 聊天记录。1. 自动提取 System Prompt。2. 自动滚动抓取完整对话。3. 深度解析 HTML，完美还原 Markdown 格式（代码块、列表、换行）。
// @author       Tokisaki Galaxy
// @match        https://aistudio.google.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const CONFIG = {
        scrollStep: 350,       // 滚动步长，推荐 300-400
        scrollDelay: 1200,     // 滚动后等待渲染时间(ms)
        uiDelay: 1000,         // 侧边栏动画等待时间
    };

    let isExporting = false;

    // --- UI: 悬浮按钮 ---
    function createExportButton() {
        if (document.getElementById('ai-studio-export-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'ai-studio-export-btn';
        btn.innerText = '导出 JSON';
        Object.assign(btn.style, {
            position: 'fixed', top: '10px', right: '100px', zIndex: '9999',
            padding: '8px 12px', backgroundColor: '#1a73e8', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)', fontWeight: 'bold',
            fontSize: '14px', fontFamily: 'sans-serif', transition: 'all 0.3s'
        });
        btn.onclick = startExportProcess;
        document.body.appendChild(btn);
    }

    function updateBtn(text, disabled = false) {
        const btn = document.getElementById('ai-studio-export-btn');
        if (btn) {
            btn.innerText = text;
            btn.disabled = disabled;
            btn.style.backgroundColor = disabled ? '#7f8c8d' : '#1a73e8';
            btn.style.cursor = disabled ? 'wait' : 'pointer';
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // --- 逻辑 1: System Instruction 抓取 ---
    async function getSystemInstruction() {
        updateBtn('获取System Prompt...');
        // 1. 尝试直接获取
        let target = document.querySelector('ms-system-instructions-panel .subtitle');
        if (target && target.innerText.trim()) return target.innerText.trim();

        // 2. 尝试打开侧边栏获取
        const toggleBtn = document.querySelector('.runsettings-toggle-button');
        if (toggleBtn) {
            console.log("Expanding sidebar...");
            toggleBtn.click();
            await sleep(CONFIG.uiDelay);

            target = document.querySelector('ms-system-instructions-panel .subtitle');
            let text = target ? target.innerText.trim() : "";
            if(!text) {
                // 备用：查找输入框
                const fallback = document.querySelector('ms-system-instruction-editor textarea');
                if(fallback) text = fallback.value;
            }

            // 恢复现场
            toggleBtn.click();
            await sleep(500);
            return text;
        }
        return "";
    }

    // --- 逻辑 2: 高级格式化 (HTML -> Markdown) ---
    function domToMarkdown(node) {
        if (!node) return "";
        let result = "";

        // 垃圾清理 (不进入递归)
        const skipClasses = ['author-label', 'actions-container', 'turn-footer', 'thinking-progress-icon', 'thought-collapsed-text', 'mat-icon'];
        if (node.classList && skipClasses.some(c => node.classList.contains(c))) return "";
        if (node.tagName === 'MS-THOUGHT-CHUNK' || node.tagName === 'BUTTON') return "";

        // --- 特殊处理: 代码块 ---
        if (node.tagName === 'MS-CODE-BLOCK') {
            // 尝试获取语言
            let lang = "";
            const titleSpan = node.querySelector('.title span:last-child'); // 通常在这里
            if (titleSpan) lang = titleSpan.innerText.trim();
            if (!lang) lang = "text"; // 默认

            // 获取代码内容，优先取 code 标签，保留格式
            const codeEl = node.querySelector('code');
            const codeText = codeEl ? codeEl.innerText : node.innerText; // innerText 保留换行

            return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`;
        }

        // --- 特殊处理: 列表 ---
        if (node.tagName === 'LI') {
            // 简单处理无序列表，暂不处理嵌套索引
            return `- ${parseChildren(node).trim()}\n`;
        }

        // --- 特殊处理: 标题 ---
        if (/^H[1-6]$/.test(node.tagName)) {
            const level = parseInt(node.tagName[1]);
            return `\n${'#'.repeat(level)} ${parseChildren(node).trim()}\n`;
        }

        // --- 特殊处理: 段落与换行 ---
        if (node.tagName === 'P') {
            return `\n${parseChildren(node).trim()}\n\n`; // 段落前后加空行
        }
        if (node.tagName === 'BR') return "\n";

        // --- 递归处理子节点 ---
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent; // 纯文本不 trim，保留行内空格
        }

        // 默认遍历子节点
        result = parseChildren(node);

        // --- 行内样式 ---
        if (node.tagName === 'STRONG' || node.tagName === 'B') result = `**${result}**`;
        if (node.tagName === 'EM' || node.tagName === 'I') result = `*${result}*`;
        // AI Studio 的 inline code 通常是 span class="inline-code"
        if (node.classList && node.classList.contains('inline-code')) result = `\`${result}\``;

        return result;
    }

    function parseChildren(node) {
        let text = "";
        node.childNodes.forEach(child => {
            text += domToMarkdown(child);
        });
        return text;
    }

    // 入口函数：提取纯净 Markdown
    function extractCleanMarkdown(turnElement) {
        const contentDiv = turnElement.querySelector('.turn-content');
        if (!contentDiv) return null;

        // 我们不克隆了，直接只读遍历，性能更好
        // 直接调用解析器
        let md = domToMarkdown(contentDiv);

        // 后处理：去除过多的空行
        md = md.replace(/\n{3,}/g, '\n\n').trim();

        if (!md || md === "Model" || md === "User") return null;
        return md;
    }

    // --- 逻辑 3: 滚动与导出主流程 ---
    async function startExportProcess() {
        if (isExporting) return;
        isExporting = true;

        const container = document.querySelector('ms-autoscroll-container');
        if (!container) {
            alert('未找到聊天区域。');
            isExporting = false;
            return;
        }

        // 1. 获取 System Prompt
        const sysInstruction = await getSystemInstruction();

        // 2. 滚动抓取
        const messageMap = new Map();
        const idOrder = [];

        updateBtn('重置视图...');
        container.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(1500);

        let lastScrollTop = -1;
        let stuckCounter = 0;

        while (true) {
            const visibleTurns = document.querySelectorAll('ms-chat-turn');
            visibleTurns.forEach(turn => {
                const uid = turn.id;
                if (!uid) return;

                if (!idOrder.includes(uid)) idOrder.push(uid);

                let role = 'user';
                if (turn.querySelector('.model-prompt-container') || turn.getAttribute('data-turn-role') === 'Model') {
                    role = 'assistant';
                }

                // 使用新的 Markdown 提取器
                const content = extractCleanMarkdown(turn);
                if (content) {
                    messageMap.set(uid, { role, content });
                }
            });

            // 滚动逻辑
            const isBottom = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 20;
            if (Math.abs(container.scrollTop - lastScrollTop) < 2) stuckCounter++;
            else stuckCounter = 0;

            const percent = Math.min(99, Math.floor((container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100));
            updateBtn(`分析中... ${percent}%`);

            if (isBottom || stuckCounter >= 3) break;

            lastScrollTop = container.scrollTop;
            container.scrollBy({ top: CONFIG.scrollStep, behavior: 'smooth' });
            await sleep(CONFIG.scrollDelay);
        }

        // 3. 导出
        updateBtn('封装JSON...');
        const validMessages = [];
        idOrder.forEach(id => {
            if (messageMap.has(id)) {
                validMessages.push(messageMap.get(id));
            }
        });

        const exportData = {
            system_instruction: sysInstruction,
            messages: validMessages
        };

        downloadFile(exportData);
        updateBtn('导出 JSON', false);
        isExporting = false;
    }

    function downloadFile(data) {
        let title = "aistudio_chat";
        try {
            const h1 = document.querySelector('.page-title h1');
            if (h1) title = h1.innerText.trim().replace(/[\\/:*?"<>|]/g, '_');
        } catch(e) {}

        const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function init() {
        const observer = new MutationObserver(() => createExportButton());
        observer.observe(document.body, { childList: true, subtree: true });
        createExportButton();
    }

    window.addEventListener('load', init);
    if (document.readyState === 'complete') init();

})();
