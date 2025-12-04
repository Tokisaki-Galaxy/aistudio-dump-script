// ==UserScript==
// @name         AI Studio Chat Exporter (Markdown & Code Block Support)
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  导出 AI Studio 聊天记录。1. 按钮默认居中并可拖拽防遮挡。2. 智能识别 System Prompt。3. 完美 Markdown 格式还原。
// @author       Tokisaki Galaxy
// @match        https://aistudio.google.com/prompts/*
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

    // --- UI: 可拖拽悬浮按钮 ---
    function createExportButton() {
        if (document.getElementById('ai-studio-export-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'ai-studio-export-btn';
        btn.innerText = '导出 JSON';
        
        // 初始样式：水平居中，垂直靠上
        Object.assign(btn.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)', // CSS 居中黑魔法
            zIndex: '99999',
            padding: '10px 16px',
            backgroundColor: '#1a73e8',
            color: 'white',
            border: 'none',
            borderRadius: '20px', // 圆角更好看
            cursor: 'move',       // 提示可移动
            boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            fontWeight: 'bold',
            fontSize: '14px',
            fontFamily: 'sans-serif',
            transition: 'background-color 0.2s, transform 0.1s', // 拖拽时取消 transform 动画防止卡顿
            userSelect: 'none'    // 防止拖拽时选中文本
        });

        // --- 拖拽核心逻辑 ---
        let isDragging = false;
        let hasMoved = false; // 用于区分点击和拖拽
        let startX, startY;
        let initialLeft, initialTop;

        btn.addEventListener('mousedown', function(e) {
            isDragging = true;
            hasMoved = false;
            
            // 获取当前按钮相对于视口的坐标
            const rect = btn.getBoundingClientRect();
            
            // 计算鼠标相对于按钮左上角的偏移
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;

            // 关键：一旦开始拖拽，移除 CSS 的 transform 居中属性，转为绝对坐标控制
            btn.style.transform = 'none';
            btn.style.left = rect.left + 'px';
            btn.style.top = rect.top + 'px';
            btn.style.opacity = '0.9'; // 拖拽时稍微变透明
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            
            hasMoved = true;
            e.preventDefault();

            // 计算新位置
            const x = e.clientX - startX;
            const y = e.clientY - startY;

            btn.style.left = `${x}px`;
            btn.style.top = `${y}px`;
        });

        document.addEventListener('mouseup', function() {
            if (isDragging) {
                isDragging = false;
                btn.style.opacity = '1';
            }
        });

        // 点击事件：如果是拖拽结束，则不触发导出
        btn.addEventListener('click', function(e) {
            if (hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            startExportProcess();
        });

        document.body.appendChild(btn);
    }

    function updateBtn(text, disabled = false) {
        const btn = document.getElementById('ai-studio-export-btn');
        if (btn) {
            btn.innerText = text;
            btn.disabled = disabled;
            btn.style.backgroundColor = disabled ? '#7f8c8d' : '#1a73e8';
            btn.style.cursor = disabled ? 'wait' : 'move';
        }
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    // --- 逻辑 1: System Instruction ---
    async function getSystemInstruction() {
        updateBtn('获取System Prompt...');
        let target = document.querySelector('ms-system-instructions-panel .subtitle');
        if (target && target.innerText.trim()) return target.innerText.trim();

        const toggleBtn = document.querySelector('.runsettings-toggle-button');
        if (toggleBtn) {
            toggleBtn.click();
            await sleep(CONFIG.uiDelay);
            
            target = document.querySelector('ms-system-instructions-panel .subtitle');
            let text = target ? target.innerText.trim() : "";
            if(!text) {
                const fallback = document.querySelector('ms-system-instruction-editor textarea');
                if(fallback) text = fallback.value;
            }

            toggleBtn.click();
            await sleep(500);
            return text;
        }
        return "";
    }

    // --- 逻辑 2: HTML -> Markdown 转换器 ---
    function domToMarkdown(node) {
        if (!node) return "";
        
        // 垃圾清理
        const skipClasses = ['author-label', 'actions-container', 'turn-footer', 'thinking-progress-icon', 'thought-collapsed-text', 'mat-icon'];
        if (node.classList && skipClasses.some(c => node.classList.contains(c))) return "";
        if (node.tagName === 'MS-THOUGHT-CHUNK' || node.tagName === 'BUTTON') return "";

        // 代码块
        if (node.tagName === 'MS-CODE-BLOCK') {
            let lang = "text";
            const titleSpan = node.querySelector('.title span:last-child');
            if (titleSpan) lang = titleSpan.innerText.trim();
            
            const codeEl = node.querySelector('code');
            const codeText = codeEl ? codeEl.innerText : node.innerText;
            return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`;
        }

        // 列表
        if (node.tagName === 'LI') return `- ${parseChildren(node).trim()}\n`;

        // 标题
        if (/^H[1-6]$/.test(node.tagName)) {
            const level = parseInt(node.tagName[1]);
            return `\n${'#'.repeat(level)} ${parseChildren(node).trim()}\n`;
        }

        // 段落与换行
        if (node.tagName === 'P') return `\n${parseChildren(node).trim()}\n\n`;
        if (node.tagName === 'BR') return "\n";

        // 文本节点
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        
        let result = parseChildren(node);

        // 格式化
        if (['STRONG', 'B'].includes(node.tagName)) result = `**${result}**`;
        if (['EM', 'I'].includes(node.tagName)) result = `*${result}*`;
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

    function extractCleanMarkdown(turnElement) {
        const contentDiv = turnElement.querySelector('.turn-content');
        if (!contentDiv) return null;
        let md = domToMarkdown(contentDiv);
        md = md.replace(/\n{3,}/g, '\n\n').trim();
        if (!md || md === "Model" || md === "User") return null;
        return md;
    }

    // --- 逻辑 3: 滚动抓取 ---
    async function startExportProcess() {
        if (isExporting) return;
        isExporting = true;

        const container = document.querySelector('ms-autoscroll-container');
        if (!container) {
            alert('未找到聊天区域。');
            isExporting = false;
            return;
        }

        const sysInstruction = await getSystemInstruction();

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

                const content = extractCleanMarkdown(turn);
                if (content) {
                    messageMap.set(uid, { role, content });
                }
            });

            const isBottom = Math.abs(container.scrollHeight - container.clientHeight - container.scrollTop) < 20;
            if (Math.abs(container.scrollTop - lastScrollTop) < 2) stuckCounter++;
            else stuckCounter = 0;

            const percent = Math.min(99, Math.floor((container.scrollTop / (container.scrollHeight - container.clientHeight)) * 100));
            updateBtn(`进度: ${percent}%`);

            if (isBottom || stuckCounter >= 3) break;

            lastScrollTop = container.scrollTop;
            container.scrollBy({ top: CONFIG.scrollStep, behavior: 'smooth' });
            await sleep(CONFIG.scrollDelay);
        }

        updateBtn('生成中...');
        const validMessages = [];
        idOrder.forEach(id => {
            if (messageMap.has(id)) {
                validMessages.push(messageMap.get(id));
            }
        });

        downloadFile({
            system_instruction: sysInstruction,
            messages: validMessages
        });

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
