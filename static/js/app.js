/**
 * WhisperX Note - Frontend JavaScript
 */

// State
let currentSessionId = null;
let activeChatId = null; // [NEW] Multi-chat support
let segments = [];
let currentActiveIndex = -1;
let downloadedFilePath = null;  // YouTube 다운로드된 파일 경로

// Recording State
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
let recordedBlob = null;

// Tab Management State
let openTabs = [{ id: 'home', type: 'home', title: '홈' }];
let activeTabId = 'home';

// DOM Elements
const createMode = document.getElementById('createMode');
const viewMode = document.getElementById('viewMode');
const sessionList = document.getElementById('sessionList');
const newBtn = document.getElementById('newBtn');
const transcribeForm = document.getElementById('transcribeForm');
const processingIndicator = document.getElementById('processingIndicator');
const startBtn = document.getElementById('startBtn');

// Audio Elements
const mainAudio = document.getElementById('mainAudio');
const segmentsList = document.getElementById('segmentsList');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');

// Tab Elements
const contentTabs = document.getElementById('contentTabs');
const playerPane = document.getElementById('playerPane');
const transcriptPane = document.getElementById('transcriptPane');
const minutesPane = document.getElementById('minutesPane');

// Settings Elements
const renameTitleInput = document.getElementById('renameTitleInput');
const renameTitleBtn = document.getElementById('renameTitleBtn');
const speakerSelect = document.getElementById('speakerSelect');
const newSpeakerName = document.getElementById('newSpeakerName');
const renameSpeakerBtn = document.getElementById('renameSpeakerBtn');
const saveBtn = document.getElementById('saveBtn');

// Diarization toggle
const diarizationCheck = document.getElementById('diarizationCheck');
const hfTokenGroup = document.getElementById('hfTokenGroup');

// Speaker color palette
const speakerColors = [
    '#e94560', '#6366f1', '#10b981', '#f59e0b', '#ec4899',
    '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
];
const speakerColorMap = {};

function getSpeakerColor(speaker) {
    if (!speakerColorMap[speaker]) {
        const idx = Object.keys(speakerColorMap).length % speakerColors.length;
        speakerColorMap[speaker] = speakerColors[idx];
    }
    return speakerColorMap[speaker];
}

// --- Document Management ---


// --- Unified Library Management ---

let libraryData = { folders: [], sessions: [], documents: [] };
let expandedFolders = new Set(); // Set of folder IDs

async function loadLibrary() {
    try {
        const res = await fetch('/api/structure');
        libraryData = await res.json();
        renderLibrary();
    } catch (e) {
        console.error("Failed to load library:", e);
    }
}

function renderLibrary() {
    const treeContainer = document.getElementById('libraryTree');
    treeContainer.innerHTML = '';

    // Assemble tree structure
    const rootNodes = buildTree(libraryData);

    rootNodes.forEach(node => {
        treeContainer.appendChild(createNodeElement(node, 0));
    });
}

function buildTree(data) {
    // Map items by ID for easy lookup
    const folderMap = new Map();
    const rootItems = [];

    // Create folder nodes
    data.folders.forEach(f => {
        f.type = 'folder';
        f.children = [];
        folderMap.set(f.id, f);
    });

    // Assign sessions/docs to folders
    [...data.sessions.map(s => ({ ...s, type: 'session' })),
    ...data.documents.map(d => ({ ...d, type: 'document' }))].forEach(item => {
        if (item.folder_id && folderMap.has(item.folder_id)) {
            folderMap.get(item.folder_id).children.push(item);
        } else {
            rootItems.push(item);
        }
    });

    // Build hierarchy (assign folders to parents)
    data.folders.forEach(f => {
        if (f.parent_id && folderMap.has(f.parent_id)) {
            folderMap.get(f.parent_id).children.push(f);
        } else {
            // No parent_id OR parent folder doesn't exist -> show at root
            // This prevents folders from disappearing when parent_id is invalid
            rootItems.push(f);
        }
    });

    // Sort: Folders first, then by date desc
    const sortFn = (a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return new Date(b.created_at || b.date) - new Date(a.created_at || a.date);
    };

    const sortRecursive = (nodes) => {
        nodes.sort(sortFn);
        nodes.forEach(n => {
            if (n.children) sortRecursive(n.children);
        });
        return nodes;
    };

    return sortRecursive(rootItems);
}

function createNodeElement(node, level) {
    const el = document.createElement('div');
    const paddingLeft = level * 16 + 8;

    if (node.type === 'folder') {
        const isExpanded = expandedFolders.has(node.id);
        el.className = 'folder-node mb-1';
        el.innerHTML = `
            <div class="d-flex align-items-center p-1 rounded hover-bg" 
                 style="padding-left: ${paddingLeft}px !important; cursor: pointer; color: #aaa;"
                 draggable="true" ondragstart="handleDragStart(event, '${node.id}', 'folder')"
                 ondragover="handleDragOver(event)" ondrop="handleDrop(event, '${node.id}')"
                 onclick="toggleFolder('${node.id}')">
                <i class="bi bi-chevron-${isExpanded ? 'down' : 'right'} me-2" style="font-size: 0.8rem;"></i>
                <i class="bi bi-folder${isExpanded ? '2-open' : ''} text-warning me-2"></i>
                <span class="text-truncate flex-grow-1 user-select-none">${node.name}</span>
                <div class="dropdown" onclick="event.stopPropagation()">
                    <button class="btn btn-link text-secondary p-0 btn-sm opacity-50" data-bs-toggle="dropdown">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark">
                        <li><a class="dropdown-item" href="#" onclick="renameFolder('${node.id}', '${node.name}')">이름 변경</a></li>
                        <li><a class="dropdown-item text-danger" href="#" onclick="deleteFolder('${node.id}')">삭제</a></li>
                    </ul>
                </div>
            </div>
        `;

        if (isExpanded) {
            const childrenContainer = document.createElement('div');
            node.children.forEach(child => {
                childrenContainer.appendChild(createNodeElement(child, level + 1));
            });
            el.appendChild(childrenContainer);
        }
    } else {
        // Session or Document
        let iconClass = 'bi-file-text';
        let iconColorClass = 'text-secondary';

        if (node.type === 'session') {
            iconClass = 'bi-mic';
        } else if (node.type === 'document') {
            const fname = (node.filename || '').toLowerCase();
            if (fname.endsWith('.pdf')) { iconClass = 'bi-file-pdf'; iconColorClass = 'text-danger'; }
            else if (fname.endsWith('.py')) { iconClass = 'bi-filetype-py'; iconColorClass = 'text-info'; }
            else if (fname.endsWith('.js')) { iconClass = 'bi-filetype-js'; iconColorClass = 'text-warning'; }
            else if (fname.endsWith('.html')) { iconClass = 'bi-filetype-html'; iconColorClass = 'text-danger'; }
            else if (fname.endsWith('.css')) { iconClass = 'bi-filetype-css'; iconColorClass = 'text-primary'; }
            else if (fname.endsWith('.json')) { iconClass = 'bi-filetype-json'; iconColorClass = 'text-warning'; }
            else if (fname.endsWith('.md')) { iconClass = 'bi-markdown'; iconColorClass = 'text-light'; }
        }

        // Check only activeTabId for highlight to prevent multiple selections
        const isActive = (typeof activeTabId !== 'undefined' && node.id === activeTabId);

        const activeBg = isActive ? 'background: rgba(255,255,255,0.05);' : '';
        const finalIconColor = isActive ? 'text-warning' : iconColorClass;
        const finalTextColor = isActive ? 'text-light' : 'text-secondary';
        const borderClass = isActive ? 'border-start border-warning border-3 bg-dark' : '';

        el.className = 'item-node mb-1';
        el.innerHTML = `
            <div class="d-flex align-items-center p-1 rounded hover-bg ${isActive ? 'active-node' : ''} ${borderClass}" 
                 style="padding-left: ${paddingLeft}px !important; cursor: pointer; ${activeBg}"
                 draggable="true" ondragstart="handleDragStart(event, '${node.id}', '${node.type}')">
                <input class="form-check-input me-2 session-checkbox" type="checkbox" value="${node.id}" 
                       onclick="event.stopPropagation()" style="transform: scale(0.8);">
                <div class="d-flex align-items-center flex-grow-1 overflow-hidden" onclick="${node.type === 'session' ? `openSession('${node.id}')` : `openDocument('${node.id}')`}">
                    <i class="bi ${iconClass} me-2 ${finalIconColor}"></i>
                    <span class="${finalTextColor} text-truncate user-select-none" style="font-size: 0.9rem;">
                        ${node.title || node.filename}
                    </span>
                </div>
                <div class="dropdown" onclick="event.stopPropagation()">
                    <button class="btn btn-link text-secondary p-0 btn-sm opacity-50" data-bs-toggle="dropdown">
                        <i class="bi bi-three-dots-vertical"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark">
                        ${node.type === 'session' ?
                `<li><a class="dropdown-item" href="#" onclick="renameItem('${node.id}', '${escapeHtml(node.title)}', 'session')">제목 수정</a></li>` :
                ''
            }
                        <li><a class="dropdown-item text-danger" href="#" onclick="deleteItem('${node.id}', '${node.type}')">삭제</a></li>
                    </ul>
                </div>
            </div>
        `;
    }

    return el;
}

function toggleFolder(id) {
    if (expandedFolders.has(id)) expandedFolders.delete(id);
    else expandedFolders.add(id);
    renderLibrary();
}

function openSession(id) {
    // Check if tab already exists
    const existingTab = openTabs.find(t => t.id === id);
    if (existingTab) {
        switchTab(id);
        return;
    }

    // Find session title from library data
    const sessionTitle = libraryData?.sessions?.find(s => s.id === id)?.title || '세션';

    // Add new tab
    openTabs.push({ id, type: 'session', title: sessionTitle });
    renderTabs();
    switchTab(id);

    // Load session content
    loadSession(id);
    renderLibrary();
}

async function openDocument(id) {
    // Check if tab already exists
    const existingTab = openTabs.find(t => t.id === id);
    if (existingTab) {
        switchTab(id);
        return;
    }

    try {
        const res = await fetch(`/api/documents/${id}/content`);
        const data = await res.json();

        if (data.success) {
            // Add new tab
            openTabs.push({
                id,
                type: 'document',
                title: data.filename,
                content: data.content,
                contentType: data.type
            });
            renderTabs();
            switchTab(id);
        } else {
            alert(data.detail || '문서를 열 수 없습니다.');
        }
    } catch (err) {
        console.error('Error opening document:', err);
        alert('문서를 여는 중 오류가 발생했습니다.');
    }
}

// Tab Management Functions
function renderTabs() {
    const tabBar = document.getElementById('tabBar');
    tabBar.innerHTML = openTabs.map(tab => {
        const isActive = tab.id === activeTabId;
        const icon = tab.type === 'home' ? 'bi-house-door' :
            tab.type === 'session' ? 'bi-mic' :
                tab.type === 'document' ? 'bi-file-text' : 'bi-file';
        const closeBtn = tab.type !== 'home' ?
            `<span class="tab-close" onclick="event.stopPropagation(); closeTab('${tab.id}')">&times;</span>` : '';

        return `
            <div class="tab-item ${isActive ? 'active-tab' : ''}" data-tab-id="${tab.id}" onclick="switchTab('${tab.id}')">
                <i class="bi ${icon}"></i>
                <span>${escapeHtml(tab.title)}</span>
                ${closeBtn}
            </div>
        `;
    }).join('');
}

function switchTab(tabId) {
    activeTabId = tabId;
    renderTabs();

    const createMode = document.getElementById('createMode');
    const viewMode = document.getElementById('viewMode');
    const documentViewerPane = document.getElementById('documentViewerPane');
    const audioControlsBar = document.getElementById('audioControlsBar');

    // Hide all content panes and remove classes
    createMode.style.display = 'none';
    viewMode.style.display = 'none';
    viewMode.classList.remove('d-flex');
    documentViewerPane.style.display = 'none';
    audioControlsBar.style.display = 'none';
    audioControlsBar.classList.remove('d-flex');

    const tab = openTabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.type === 'home') {
        createMode.style.display = 'block';
        currentSessionId = null;
        // Load global chat list when on home tab
        loadChatList('global');
    } else if (tab.type === 'session') {
        viewMode.style.display = 'flex';
        viewMode.classList.add('d-flex');
        audioControlsBar.style.display = 'flex';
        audioControlsBar.classList.add('d-flex');
        if (currentSessionId !== tab.id) {
            currentSessionId = tab.id;
            loadSession(tab.id);
        }
    } else if (tab.type === 'document') {
        documentViewerPane.style.display = 'flex';
        showDocumentContent(tab);
    }

    renderLibrary();
}

function showDocumentContent(tab) {
    document.getElementById('documentViewerPaneTitle').textContent = tab.title;
    const contentArea = document.getElementById('documentViewerPaneContent');

    if (tab.contentType === 'pdf') {
        contentArea.innerHTML = `
            <iframe src="data:application/pdf;base64,${tab.content}" 
                    style="width: 100%; height: 100%; border: none;"></iframe>
        `;
    } else {
        contentArea.innerHTML = `
            <pre class="text-light m-0 language-${tab.contentType}" 
                 style="white-space: pre-wrap; word-wrap: break-word; font-family: 'SF Mono', Monaco, monospace; font-size: 13px; line-height: 1.5;"></pre>
        `;
        contentArea.querySelector('pre').textContent = tab.content;
    }
}

function closeTab(tabId) {
    const tabIndex = openTabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    openTabs.splice(tabIndex, 1);

    // If closing active tab, switch to previous tab or home
    if (activeTabId === tabId) {
        const newActiveTab = openTabs[Math.max(0, tabIndex - 1)] || openTabs[0];
        activeTabId = newActiveTab.id;
    }

    renderTabs();
    switchTab(activeTabId);
}

// --- Drag & Drop ---
function handleDragStart(e, id, type) {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id, type }));
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

async function handleDrop(e, targetFolderId) {
    e.preventDefault();
    e.stopPropagation(); // Stop bubbling

    // Remove drag-over highlights if any
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

    let data;
    try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch (err) { return; }

    if (!data || !data.id) return;

    // Prevent dropping folder into itself
    if (data.type === 'folder' && data.id === targetFolderId) return;

    // Call API
    const formData = new FormData();
    formData.append('item_id', data.id);
    formData.append('type', data.type);
    formData.append('target_folder_id', targetFolderId || 'root'); // 'root' or valid ID

    try {
        const res = await fetch('/api/move', { method: 'PUT', body: formData });
        const result = await res.json();
        if (result.success) {
            loadLibrary();
        } else {
            alert("이동 실패: " + result.detail);
        }
    } catch (err) {
        console.error(err);
    }
}

// --- Folder Ops ---
async function createNewFolder() {
    const name = prompt("폴더 이름:");
    if (!name) return;

    const formData = new FormData();
    formData.append('name', name);
    formData.append('parent_id', 'root'); // Default to root for now

    await fetch('/api/folders', { method: 'POST', body: formData });
    loadLibrary();
}

async function renameFolder(id, oldName) {
    const name = prompt("새 이름:", oldName);
    if (!name) return;

    const formData = new FormData();
    formData.append('name', name);
    await fetch(`/api/folders/${id}`, { method: 'PUT', body: formData });
    loadLibrary();
}

async function renameItem(id, currentTitle, type) {
    if (type === 'session') {
        document.getElementById('renameSessionId').value = id;
        document.getElementById('renameSessionInput').value = currentTitle;
        const modal = new bootstrap.Modal(document.getElementById('renameSessionModal'));
        modal.show();
    }
}

async function deleteFolder(id) {
    showDeleteConfirmModal(id, 'folder', '폴더를 삭제하시겠습니까?', '내용물은 루트로 이동됩니다.');
}

async function deleteItem(id, type) {
    const typeName = type === 'session' ? '세션' : '문서';
    const warning = type === 'session' ? '오디오, 전사, 채팅 기록이 영구 삭제됩니다.' : '';
    showDeleteConfirmModal(id, type, `이 ${typeName}을(를) 삭제하시겠습니까?`, warning);
}

function showDeleteConfirmModal(id, type, message, warning) {
    document.getElementById('deleteConfirmItemId').value = id;
    document.getElementById('deleteConfirmItemType').value = type;
    document.getElementById('deleteConfirmMessage').textContent = message;
    document.getElementById('deleteConfirmWarning').textContent = warning || '';
    const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
    modal.show();
}

// --- Init & Listeners ---
function setupLibraryListeners() {
    document.getElementById('newFolderBtn').addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('createFolderModal'));
        modal.show();
        setTimeout(() => document.getElementById('newFolderNameInput').focus(), 500);
    });

    // Bind Add Doc button
    const fileInput = document.getElementById('docFileInput');
    document.getElementById('addDocBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        if (fileInput.files.length > 0) {
            await uploadDocuments(fileInput.files);
            fileInput.value = '';
        }
    });
}

function uploadDocuments(files) {
    // ... existing implementation adapted to call loadLibrary() at end ...
    // Reuse existing upload logic but simple copy for now or modify
    // Let's implement simple version here since I'm replacing the block

    const processingIndicator = document.getElementById('processingIndicator');
    document.body.style.cursor = 'wait';

    (async () => {
        try {
            for (let file of files) {
                const formData = new FormData();
                formData.append('file', file);
                await fetch('/api/documents', { method: 'POST', body: formData });
            }
            loadLibrary();
        } catch (e) {
            console.error(e);
            alert('업로드 오류');
        } finally {
            document.body.style.cursor = 'default';
        }
    })();
}


function setupModalHandlers() {
    // Confirm Rename
    document.getElementById('confirmRenameBtn').addEventListener('click', async () => {
        const sessionId = document.getElementById('renameSessionId').value;
        const newTitle = document.getElementById('renameSessionInput').value.trim();

        if (!newTitle) {
            alert("제목을 입력해주세요.");
            return;
        }

        try {
            const formData = new FormData();
            formData.append('title', newTitle);

            const res = await fetch(`/api/session/${sessionId}/title`, {
                method: 'PUT',
                body: formData
            });

            const data = await res.json();
            if (data.success) {
                // Close modal
                const modalEl = document.getElementById('renameSessionModal');
                const modal = bootstrap.Modal.getInstance(modalEl);
                modal.hide();

                // Reload list
                loadSessions();

                // If current session, update title in view
                if (currentSessionId === sessionId) {
                    loadSession(sessionId);
                }
            } else {
                alert('수정 실패: ' + (data.detail || '오류가 발생했습니다'));
            }
        } catch (err) {
            console.error(err);
            alert('오류가 발생했습니다.');
        }
    });

    // Confirm Delete
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
        const sessionId = document.getElementById('deleteSessionId').value;

        try {
            await deleteSession(sessionId);

            // Close modal
            const modalEl = document.getElementById('deleteSessionModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

        } catch (err) {
            console.error(err);
        }
    });

    // Confirm Create Folder
    document.getElementById('confirmCreateFolderBtn').addEventListener('click', async () => {
        const nameInput = document.getElementById('newFolderNameInput');
        const name = nameInput.value.trim();
        if (!name) return;

        try {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('parent_id', 'root');

            await fetch('/api/folders', { method: 'POST', body: formData });

            // Close modal
            const modalEl = document.getElementById('createFolderModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            nameInput.value = '';

            loadLibrary();
        } catch (e) {
            console.error(e);
            alert("폴더 생성 실패");
        }
    });

    // Confirm Generic Delete
    document.getElementById('confirmGenericDeleteBtn').addEventListener('click', async () => {
        const itemId = document.getElementById('deleteConfirmItemId').value;
        const itemType = document.getElementById('deleteConfirmItemType').value;

        try {
            let url;
            if (itemType === 'folder') {
                url = `/api/folders/${itemId}`;
            } else if (itemType === 'session') {
                url = `/api/session/${itemId}`;
            } else {
                url = `/api/documents/${itemId}`;
            }

            const res = await fetch(url, { method: 'DELETE' });
            const data = await res.json();

            // Close modal
            const modalEl = document.getElementById('deleteConfirmModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

            if (data.success) {
                // Close tab if open
                const tabExists = openTabs.find(t => t.id === itemId);
                if (tabExists) {
                    closeTab(itemId);
                }
                loadLibrary();
            } else {
                alert("삭제 실패: " + (data.detail || ''));
            }
        } catch (e) {
            console.error(e);
            alert("삭제 중 오류가 발생했습니다.");
        }
    });
}

function setupResizeHandler() {
    const chatResizer = document.getElementById('chatResizer');
    const chatPanel = document.getElementById('chatPanel');
    const chatToggleBtn = document.getElementById('chatToggleBtn');
    let isResizing = false;

    chatResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        chatResizer.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        // Calculate new width (from right edge)
        const newWidth = document.body.clientWidth - e.clientX;

        // Min/Max constraints
        if (newWidth >= 300 && newWidth <= 800) {
            chatPanel.style.width = `${newWidth}px`;

            // Sync input bar width
            const inputBar = document.getElementById('chatInputBar');
            if (inputBar) inputBar.style.width = `${newWidth}px`;

            // Ensure visible if dragging
            if (!chatExpanded) {
                chatExpanded = true;
                chatToggleBtn.classList.add('active');
                if (inputBar) inputBar.style.display = 'block';
            }
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            chatResizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

function setupEventListeners() {
    // New button
    newBtn.addEventListener('click', () => {
        currentSessionId = null;
        showCreateMode();
        // Clear selection in library
        document.querySelectorAll('.item-node .active-node').forEach(el => {
            el.classList.remove('active-node');
            el.classList.remove('border-warning');
            el.classList.remove('border-start');
            el.classList.remove('border-3');
            el.style.background = '';
            // Reset text color to secondary
            const span = el.querySelector('span');
            if (span) {
                span.classList.remove('text-light');
                span.classList.add('text-secondary');
            }
            const icon = el.querySelector('i');
            if (icon) icon.classList.remove('text-warning');
        });
    });

    // Save button
    saveBtn.addEventListener('click', downloadTranscript);

    // Transcribe form
    transcribeForm.addEventListener('submit', handleTranscribe);

    // Reindex button (수동 임베딩)
    const reindexBtn = document.getElementById('reindexBtn');
    if (reindexBtn) {
        reindexBtn.addEventListener('click', async () => {
            if (!currentSessionId) {
                showToast('세션을 먼저 선택하세요');
                return;
            }

            reindexBtn.disabled = true;
            reindexBtn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>처리 중...';

            try {
                const res = await fetch(`/api/index/${currentSessionId}`, { method: 'POST' });
                const data = await res.json();

                if (data.success) {
                    showToast('임베딩 완료');
                } else {
                    showToast('임베딩 실패: ' + (data.detail || ''));
                }
            } catch (err) {
                console.error('Reindex error:', err);
                showToast('임베딩 오류');
            } finally {
                reindexBtn.disabled = false;
                reindexBtn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i>다시 임베딩';
            }
        });
    }

    // Diarization toggle
    diarizationCheck.addEventListener('change', () => {
        hfTokenGroup.style.display = diarizationCheck.checked ? 'block' : 'none';
    });

    // Drop zone
    const dropZone = document.getElementById('dropZone');
    const audioFileInput = document.getElementById('audioFile');
    const selectedFileName = document.getElementById('selectedFileName');

    dropZone.addEventListener('click', () => audioFileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-primary');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-primary');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-primary');
        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].type.startsWith('audio/')) {
            audioFileInput.files = files;
            showSelectedFile(files[0].name);
        }
    });

    audioFileInput.addEventListener('change', () => {
        if (audioFileInput.files.length > 0) {
            showSelectedFile(audioFileInput.files[0].name);
        }
    });

    function showSelectedFile(name) {
        selectedFileName.style.display = 'block';
        selectedFileName.querySelector('span').textContent = name;
    }

    // YouTube download
    const youtubeDownloadBtn = document.getElementById('youtubeDownloadBtn');
    youtubeDownloadBtn.addEventListener('click', async () => {
        const url = document.getElementById('youtubeUrl').value;
        if (!url) {
            alert('YouTube URL을 입력하세요.');
            return;
        }

        youtubeDownloadBtn.disabled = true;
        youtubeDownloadBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

        try {
            const res = await fetch('/api/youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();

            if (data.success) {
                downloadedFilePath = data.path;
                // Set the title if available
                if (data.title) {
                    document.getElementById('titleInput').value = data.title;
                }
                // 다운로드 완료 표시
                const fileNameEl = document.getElementById('selectedFileName');
                fileNameEl.style.display = 'block';
                fileNameEl.querySelector('span').textContent = data.filename;
                document.getElementById('audioFile').required = false;
                showToast('YouTube 오디오 다운로드 완료!');
            } else {
                showToast('다운로드 실패: ' + (data.detail || '알 수 없는 오류'));
            }
        } catch (err) {
            console.error('YouTube download error:', err);
            showToast('YouTube 다운로드 중 오류가 발생했습니다.');
        } finally {
            youtubeDownloadBtn.disabled = false;
            youtubeDownloadBtn.innerHTML = '<i class="bi bi-download"></i>';
        }
    });

    // Tab switching
    contentTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (!btn) return;

        const tab = btn.dataset.tab;

        // Update tab buttons
        contentTabs.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');

        // Show corresponding pane
        playerPane.style.display = tab === 'player' ? 'flex' : 'none';
        transcriptPane.style.display = tab === 'transcript' ? 'block' : 'none';
        minutesPane.style.display = tab === 'minutes' ? 'block' : 'none';
    });

    // Audio time update
    mainAudio.addEventListener('timeupdate', handleTimeUpdate);

    // Prev/Next buttons
    prevBtn.addEventListener('click', () => {
        if (currentActiveIndex > 0) {
            jumpToSegment(currentActiveIndex - 1);
        } else if (segments.length > 0) {
            jumpToSegment(0);
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentActiveIndex < segments.length - 1) {
            jumpToSegment(currentActiveIndex + 1);
        }
    });

    // Rename title
    renameTitleBtn.addEventListener('click', async () => {
        if (!currentSessionId || !renameTitleInput.value) return;

        const formData = new FormData();
        formData.append('title', renameTitleInput.value);

        await fetch(`/api/session/${currentSessionId}/title`, {
            method: 'PUT',
            body: formData
        });

        loadSessions();
    });

    // Rename speaker
    renameSpeakerBtn.addEventListener('click', async () => {
        if (!currentSessionId || !speakerSelect.value || !newSpeakerName.value) {
            console.log('Missing values:', { currentSessionId, speaker: speakerSelect.value, newName: newSpeakerName.value });
            return;
        }

        console.log('Renaming speaker:', speakerSelect.value, '->', newSpeakerName.value);

        const formData = new FormData();
        formData.append('old_name', speakerSelect.value);
        formData.append('new_name', newSpeakerName.value);

        const res = await fetch(`/api/session/${currentSessionId}/speaker`, {
            method: 'PUT',
            body: formData
        });
        const data = await res.json();
        console.log('Speaker rename result:', data);

        loadSession(currentSessionId);
    });

    // Save button
    saveBtn.addEventListener('click', () => {
        const format = document.querySelector('input[name="format"]:checked').value;
        const content = document.getElementById('minutesContent').innerText;
        const filename = `minutes.${format === 'md' ? 'md' : 'txt'}`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    });

    // Sidebar toggle
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarIcon = document.getElementById('sidebarIcon');
    const audioControlsBar = document.getElementById('audioControlsBar');
    let sidebarCollapsed = false;

    sidebarToggle.addEventListener('click', () => {
        sidebarCollapsed = !sidebarCollapsed;
        if (sidebarCollapsed) {
            sidebar.style.width = '0';
            sidebar.style.overflow = 'hidden';
            sidebarIcon.className = 'bi bi-chevron-right';
            audioControlsBar.style.left = '24px'; // Only toggle button width
        } else {
            sidebar.style.width = '250px';
            sidebar.style.overflow = '';
            sidebarIcon.className = 'bi bi-chevron-left';
            audioControlsBar.style.left = '274px'; // Sidebar + toggle
        }
    });
}

// function loadSessions removed (replaced by loadLibrary)
// function deleteSession removed (replaced by deleteItem)

async function loadSession(sessionId) {
    try {
        const res = await fetch(`/api/session/${sessionId}`);
        const data = await res.json();

        currentSessionId = sessionId;
        segments = data.segments || [];

        // Set audio
        if (data.audio.base64) {
            mainAudio.src = `data:${data.audio.mime};base64,${data.audio.base64}`;
            const audioControlsBar = document.getElementById('audioControlsBar');
            audioControlsBar.classList.add('d-flex');
            audioControlsBar.style.display = 'flex';
        }

        // Render segments
        renderSegments();

        // Set transcript
        document.getElementById('transcriptContent').textContent = data.transcript;

        // Set minutes (render markdown)
        document.getElementById('minutesContent').innerHTML = marked.parse(data.minutes);

        // Set settings
        renameTitleInput.value = data.meta.title || '';

        // Populate speaker dropdown
        speakerSelect.innerHTML = data.speakers.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');

        // Populate speaker dropdown
        speakerSelect.innerHTML = data.speakers.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');

        // Load chat list and pick latest
        await loadChatList(sessionId);

        showViewMode();
    } catch (err) {
        console.error('Failed to load session:', err);
    }
}

function renderSegments() {
    segmentsList.innerHTML = segments.map((seg, idx) => {
        const start = formatTime(seg.start);
        const end = formatTime(seg.end);
        const speaker = seg.speaker || '';
        const color = getSpeakerColor(speaker);

        return `
            <div class="segment" data-index="${idx}" data-start="${seg.start}" data-end="${seg.end}">
                <div class="segment-header">
                    <div class="segment-time">
                        ${start} - ${end}
                        ${speaker ? `<span class="speaker-badge" style="background:${color}">${speaker}</span>` : ''}
                    </div>
                    <div class="segment-menu dropdown" onclick="event.stopPropagation()">
                        <button class="btn btn-link text-secondary p-0 segment-menu-btn" data-bs-toggle="dropdown">
                            <i class="bi bi-three-dots"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
                            <li><a class="dropdown-item" href="#" onclick="editSegmentSpeaker(${idx})"><i class="bi bi-person me-2"></i>화자 편집</a></li>
                            <li><a class="dropdown-item" href="#" onclick="editSegmentText(${idx})"><i class="bi bi-pencil me-2"></i>텍스트 편집</a></li>
                        </ul>
                    </div>
                </div>
                <div class="segment-text">${seg.text}</div>
            </div>
        `;
    }).join('');

    // Add click handlers
    segmentsList.querySelectorAll('.segment').forEach(el => {
        el.addEventListener('click', () => {
            const start = parseFloat(el.dataset.start);
            mainAudio.currentTime = start;
            mainAudio.play();
        });
    });

    // Render speaker visualization orbs
    if (typeof renderSpeakerOrbs === 'function') {
        renderSpeakerOrbs();
    }
}

// Segment editing functions
function editSegmentSpeaker(index) {
    const seg = segments[index];

    // Set index
    document.getElementById('editSpeakerIndex').value = index;

    // Populate speaker dropdown with existing speakers
    const select = document.getElementById('editSpeakerSelect');
    const existingSpeakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
    select.innerHTML = '<option value="">-- 선택 --</option>' +
        existingSpeakers.map(s => `<option value="${s}" ${s === seg.speaker ? 'selected' : ''}>${s}</option>`).join('');

    // Clear custom input
    document.getElementById('editSpeakerCustom').value = '';

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('editSpeakerModal'));
    modal.show();
}

function editSegmentText(index) {
    const seg = segments[index];

    // Set values
    document.getElementById('editTextIndex').value = index;
    document.getElementById('editTextContent').value = seg.text;

    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('editTextModal'));
    modal.show();
}

// Setup segment edit modal handlers
function setupSegmentEditHandlers() {
    // Speaker edit confirm
    document.getElementById('confirmEditSpeakerBtn').addEventListener('click', () => {
        const index = parseInt(document.getElementById('editSpeakerIndex').value);
        const customValue = document.getElementById('editSpeakerCustom').value.trim();
        const selectValue = document.getElementById('editSpeakerSelect').value;

        // Custom input takes priority
        const newSpeaker = customValue || selectValue;

        if (newSpeaker !== undefined) {
            segments[index].speaker = newSpeaker;
            renderSegments();
            saveSegmentEdit(index, 'speaker', newSpeaker);
        }

        bootstrap.Modal.getInstance(document.getElementById('editSpeakerModal')).hide();
    });

    // Text edit confirm
    document.getElementById('confirmEditTextBtn').addEventListener('click', () => {
        const index = parseInt(document.getElementById('editTextIndex').value);
        const newText = document.getElementById('editTextContent').value;

        if (newText !== undefined) {
            segments[index].text = newText;
            renderSegments();
            saveSegmentEdit(index, 'text', newText);
        }

        bootstrap.Modal.getInstance(document.getElementById('editTextModal')).hide();
    });
}

async function saveSegmentEdit(index, field, value) {
    try {
        const formData = new FormData();
        formData.append('index', index);
        formData.append('field', field);
        formData.append('value', value);

        await fetch(`/api/session/${currentSessionId}/segment`, {
            method: 'PUT',
            body: formData
        });
    } catch (err) {
        console.error('Failed to save segment edit:', err);
    }
}

function handleTimeUpdate() {
    const currentTime = mainAudio.currentTime;
    let newActiveIndex = -1;

    segments.forEach((seg, idx) => {
        if (currentTime >= seg.start && currentTime < seg.end) {
            newActiveIndex = idx;
        }
    });

    if (newActiveIndex !== currentActiveIndex) {
        // Remove old active
        if (currentActiveIndex >= 0) {
            const oldEl = segmentsList.querySelector(`[data-index="${currentActiveIndex}"]`);
            if (oldEl) oldEl.classList.remove('active');
        }
        // Add new active
        if (newActiveIndex >= 0) {
            const newEl = segmentsList.querySelector(`[data-index="${newActiveIndex}"]`);
            if (newEl) {
                newEl.classList.add('active');
                // 부모 컨테이너 내에서만 스크롤 (전체 페이지 스크롤 방지)
                const container = segmentsList.closest('[style*="overflow"]') || segmentsList.parentElement;
                if (container) {
                    const containerRect = container.getBoundingClientRect();
                    const elRect = newEl.getBoundingClientRect();
                    const scrollOffset = elRect.top - containerRect.top - (containerRect.height / 2) + (elRect.height / 2);
                    container.scrollBy({ top: scrollOffset, behavior: 'smooth' });
                }
            }
            // Update speaker orb visualization
            const currentSpeaker = segments[newActiveIndex]?.speaker;
            if (typeof updateSpeakingOrb === 'function') {
                updateSpeakingOrb(currentSpeaker);
            }
        } else {
            // No active segment - clear orb highlights
            if (typeof updateSpeakingOrb === 'function') {
                updateSpeakingOrb(null);
            }
        }
        currentActiveIndex = newActiveIndex;
    }
}

function jumpToSegment(index) {
    if (index >= 0 && index < segments.length) {
        mainAudio.currentTime = segments[index].start;
        mainAudio.play();
    }
}

async function handleTranscribe(e) {
    e.preventDefault();

    const audioFile = document.getElementById('audioFile').files[0];

    // 녹음된 오디오 체크 (녹음 우선)
    if (recordedBlob && !audioFile && !downloadedFilePath) {
        await handleRecordedTranscribe();
        return;
    }

    // YouTube 다운로드 파일도 없고 업로드 파일도 없으면 리턴
    if (!audioFile && !downloadedFilePath) {
        alert('오디오 파일을 선택하거나 녹음하거나 YouTube URL을 입력하세요.');
        return;
    }

    // Show processing
    startBtn.disabled = true;
    processingIndicator.style.display = 'block';

    try {
        let res;

        if (downloadedFilePath) {
            // YouTube 다운로드 파일 사용
            res = await fetch('/api/transcribe-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    file_path: downloadedFilePath,
                    title: document.getElementById('titleInput').value || '무제',
                    participants: document.getElementById('participantsInput').value,
                    agenda: document.getElementById('agendaInput').value,
                    language: document.getElementById('languageSelect').value,
                    enable_diarization: diarizationCheck.checked,
                    hf_token: document.getElementById('hfTokenInput').value
                })
            });
        } else {
            // 업로드 파일 사용
            const formData = new FormData();
            formData.append('audio', audioFile);
            formData.append('title', document.getElementById('titleInput').value || '무제');
            formData.append('participants', document.getElementById('participantsInput').value);
            formData.append('agenda', document.getElementById('agendaInput').value);
            formData.append('language', document.getElementById('languageSelect').value);
            formData.append('enable_diarization', diarizationCheck.checked);
            formData.append('hf_token', document.getElementById('hfTokenInput').value);

            res = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
        }

        const data = await res.json();

        if (data.success) {
            downloadedFilePath = null;  // 초기화
            loadLibrary();
            loadSession(data.session_id);
            showToast('전사 완료!');
        } else {
            showToast('전사 실패: ' + (data.detail || '알 수 없는 오류'));
        }
    } catch (err) {
        console.error('Transcribe error:', err);
        showToast('전사 중 오류가 발생했습니다.');
    } finally {
        startBtn.disabled = false;
        processingIndicator.style.display = 'none';
    }
}

function showCreateMode() {
    currentSessionId = null; // Reset session ID
    createMode.style.display = 'block';

    viewMode.classList.remove('d-flex');
    viewMode.style.display = 'none';

    // 문서 뷰어도 숨기기
    const documentViewerPane = document.getElementById('documentViewerPane');
    if (documentViewerPane) {
        documentViewerPane.classList.remove('d-flex');
        documentViewerPane.style.display = 'none';
    }

    const audioControlsBar = document.getElementById('audioControlsBar');
    audioControlsBar.classList.remove('d-flex');
    audioControlsBar.style.display = 'none';
    // Chat panel now stays visible - don't hide it

    // Clear selections
    sessionList.querySelectorAll('.list-group-item').forEach(item => {
        item.classList.remove('active-session-bg');
    });

    transcribeForm.reset();
    downloadedFilePath = null;
    document.getElementById('audioFile').required = true;
    document.getElementById('selectedFileName').style.display = 'none';
    processingIndicator.style.display = 'none';

    // 녹음 미리듣기도 숨기기
    const recordedPreview = document.getElementById('recordedAudioPreview');
    if (recordedPreview) recordedPreview.style.display = 'none';
    recordedBlob = null;
    recordedChunks = [];
}

function showViewMode() {
    createMode.style.display = 'none';
    viewMode.classList.add('d-flex');
    viewMode.style.display = 'flex';
    // document.getElementById('audioControlsBar').style.display = 'flex'; // Don't show by default
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ============ Chat Functions ============

const chatPanel = document.getElementById('chatPanel');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
let chatExpanded = true; // Start expanded by default

// Toggle chat panel via toolbar button
chatToggleBtn.addEventListener('click', () => {
    chatExpanded = !chatExpanded;
    updateChatVisibility();
});

function updateChatVisibility() {
    const chatInputBar = document.getElementById('chatInputBar');
    const chatPanel = document.getElementById('chatPanel');
    const chatIcon = document.getElementById('chatIcon');

    // Get current width or default to 350px
    let targetWidth = chatPanel.style.width;
    if (!targetWidth || targetWidth === '0px' || targetWidth === '0') {
        targetWidth = '350px';
    }

    if (chatExpanded) {
        chatPanel.style.width = targetWidth;
        chatPanel.style.overflow = '';
        chatInputBar.style.display = 'block';
        chatInputBar.style.width = targetWidth;
        chatToggleBtn.classList.add('active');
        // Change icon to close/collapse
        if (chatIcon) chatIcon.className = 'bi bi-chevron-right';
    } else {
        chatPanel.style.width = '0';
        chatPanel.style.overflow = 'hidden';
        chatInputBar.style.display = 'none';
        chatToggleBtn.classList.remove('active');
        // Change icon to open chat
        if (chatIcon) chatIcon.className = 'bi bi-chat-dots';
    }
}

// Send message
async function sendChatMessage() {
    const question = chatInput.value.trim();
    if (!question) return;

    // 선택된 세션 ID 수집
    const checkedBoxes = document.querySelectorAll('.session-checkbox:checked');
    let targetSessionIds = Array.from(checkedBoxes).map(cb => cb.value);

    // 선택된 게 없으면 현재 열린 세션 사용
    if (targetSessionIds.length === 0 && currentSessionId) {
        targetSessionIds = [currentSessionId];
    }

    // [MODIFIED] Allow empty targetSessionIds for Global Chat
    if (targetSessionIds.length === 0) {
        // Global Chat Mode: No warning needed.
        // Backend handles empty session_ids as "global" session.
    }

    // Add user message
    addMessageToChat('user', question);
    chatInput.value = '';

    // Add loading indicator
    const loadingId = addLoadingMessage();

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_ids: targetSessionIds, // 리스트 전송
                question: question,
                chat_id: activeChatId // [NEW] Send chat_id
            })
        });
        const data = await res.json();

        removeLoadingMessage(loadingId);

        if (data.success) {
            addMessageToChat('assistant', data.answer);
        } else {
            addMessageToChat('error', data.detail || '오류가 발생했습니다.');
        }
    } catch (err) {
        removeLoadingMessage(loadingId);
        addMessageToChat('error', '서버 연결 오류');
        console.error('Chat error:', err);
    }
}

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

function addMessageToChat(role, content) {
    // Remove placeholder if exists
    const placeholder = chatMessages.querySelector('.text-center');
    if (placeholder) placeholder.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message chat-${role} mb-3`;

    if (role === 'user') {
        msgDiv.className = 'chat-message mb-3 text-end';
        msgDiv.innerHTML = `
            <div class="d-flex justify-content-end">
                <div class="bg-dark border border-warning text-light rounded-3 px-3 py-2" style="max-width: 85%;">
                    ${escapeHtml(content)}
                </div>
            </div>
        `;
    } else if (role === 'assistant') {
        const renderedContent = marked.parse(content);
        msgDiv.innerHTML = `
            <div class="d-flex">
                <div class="bg-transparent border border-warning rounded-3 px-3 py-2" style="max-width: 85%;">
                    <i class="bi bi-robot text-warning me-1"></i>
                    <div class="markdown-content">${renderedContent}</div>
                </div>
            </div>
        `;
    } else if (role === 'error') {
        msgDiv.innerHTML = `
            <div class="d-flex">
                <div class="bg-danger bg-opacity-25 text-danger rounded-3 px-3 py-2">
                    <i class="bi bi-exclamation-triangle me-1"></i>
                    ${escapeHtml(content)}
                </div>
            </div>
        `;
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addLoadingMessage() {
    const id = 'loading-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.id = id;
    msgDiv.className = 'chat-message mb-3';
    msgDiv.innerHTML = `
        <div class="d-flex">
            <div class="bg-secondary rounded-3 px-3 py-2">
                <span class="spinner-border spinner-border-sm text-info me-2"></span>
                생각 중...
            </div>
        </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}

function removeLoadingMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Copy transcript with timeline and speaker
function copyTranscript() {
    if (segments.length === 0) {
        alert('복사할 전사 내용이 없습니다.');
        return;
    }

    // Build transcript with timeline and speaker
    const text = segments.map(seg => {
        const start = formatTime(seg.start);
        const end = formatTime(seg.end);
        const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
        return `[${start} - ${end}] ${speaker}${seg.text}`;
    }).join('\n\n');

    navigator.clipboard.writeText(text).then(() => {
        showToast('복사됨');
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

function copyMinutes() {
    const text = document.getElementById('minutesContent').innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast('복사됨');
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Download transcript function
function downloadTranscript() {
    if (segments.length === 0) {
        alert('저장할 전사 내용이 없습니다.');
        return;
    }

    const format = document.querySelector('input[name="format"]:checked').value;
    let content = '';

    // Always include timeline and speaker info
    if (format === 'md') {
        content = segments.map(seg => {
            const start = formatTime(seg.start);
            const end = formatTime(seg.end);
            const speaker = seg.speaker ? `**[${seg.speaker}]**` : '';
            return `### [${start} - ${end}] ${speaker}\n${seg.text}`;
        }).join('\n\n');
    } else {
        content = segments.map(seg => {
            const start = formatTime(seg.start);
            const end = formatTime(seg.end);
            const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
            return `[${start} - ${end}] ${speaker}${seg.text}`;
        }).join('\n\n');
    }

    const ext = format === 'md' ? 'md' : 'txt';
    const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';

    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `전사본_${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Clear chat when session changes
function clearChat() {
    chatMessages.innerHTML = `
        <div class="text-center text-secondary small py-4">
            <i class="bi bi-chat-quote display-4 opacity-50"></i>
            <p class="mt-2">회의 내용에 대해 질문해보세요!</p>
            <p class="small opacity-75">예: "이 회의에서 결정된 사항이 뭐야?"</p>
        </div>
    `;
}


document.addEventListener('DOMContentLoaded', () => {
    setupLibraryListeners();
    loadLibrary();
    setupEventListeners();
    // setupDocumentListeners(); // Replaced by setupLibraryListeners
    setupResizeHandler();
    setupModalHandlers();
    setupSegmentEditHandlers();

    setupSidebarResizeHandler();
    setupPlayerPositionObservers();

    // Initialize tab system
    renderTabs();
    switchTab('home');

    // Initialize chat panel state (expanded by default)
    updateChatVisibility();

});

async function loadChatList(sessionId) {
    // Use 'global' if no sessionId provided
    const sid = sessionId || 'global';

    try {
        const res = await fetch(`/api/session/${sid}/chats`);
        const data = await res.json();
        const listEl = document.getElementById('chatHistoryList');

        if (!listEl) return;

        if (!data.chats || data.chats.length === 0) {
            // If no chats, create default silently
            await createNewChatSilent(sid);
            return;
        }

        listEl.innerHTML = data.chats.map(chat => {
            // Format time: "12월 14일 10:00"
            const date = new Date(chat.updated_at).toLocaleString('ko-KR', {
                month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
            });
            // Highlight active
            const activeClass = (chat.id === activeChatId) ? 'active' : '';
            return `<li><a class="dropdown-item ${activeClass}" href="#" onclick="switchChat('${chat.id}')">
                <div class="d-flex justify-content-between align-items-center">
                    <span>${date}</span>
                    <i class="bi bi-chat-text text-secondary ms-2" style="font-size: 0.8em"></i>
                </div>
            </a></li>`;
        }).join('');

        // If activeChatId not set or invalid, pick first
        if (!activeChatId || !data.chats.find(c => c.id === activeChatId)) {
            // Use the most recent (first in list)
            if (data.chats.length > 0) {
                await switchChat(data.chats[0].id);
            }
        } else {
            // Just refresh UI - update active highlight
            listEl.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            const activeItem = Array.from(listEl.querySelectorAll('a')).find(a => a.getAttribute('onclick')?.includes(activeChatId));
            if (activeItem) activeItem.classList.add('active');
        }

    } catch (err) {
        console.error('Failed to load chat list:', err);
    }
}

// Silent version for auto-creating chat when none exists
async function createNewChatSilent(sessionId) {
    const sid = sessionId || 'global';
    try {
        const res = await fetch(`/api/session/${sid}/chats`, { method: 'POST' });
        const data = await res.json();
        activeChatId = data.chat_id;
        await loadChatList(sid);
    } catch (err) {
        console.error('Failed to create new chat silently:', err);
    }
}

async function createNewChat(e) {
    // Prevent event default if triggered by click
    if (e && e.preventDefault) e.preventDefault();

    const sid = currentSessionId || 'global';

    try {
        const res = await fetch(`/api/session/${sid}/chats`, { method: 'POST' });
        const data = await res.json();

        activeChatId = data.chat_id;
        clearChat(); // Clear current chat messages
        await loadChatList(sid); // Refresh list and switch
        showToast('새 대화 시작');
    } catch (err) {
        console.error('Failed to create new chat:', err);
    }
}

async function switchChat(chatId) {
    activeChatId = chatId;
    chatMessages.innerHTML = '';

    // Use 'global' when no session is selected
    const sessionForChat = currentSessionId || 'global';

    // Update Dropdown Title
    const listEl = document.getElementById('chatHistoryList');
    if (listEl) {
        const item = Array.from(listEl.querySelectorAll('a')).find(a => a.getAttribute('onclick')?.includes(chatId));
        if (item) {
            // Toggle 'active' class
            listEl.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
        }
    }

    try {
        const res = await fetch(`/api/session/${sessionForChat}/chat/${chatId}`);
        const data = await res.json();

        if (data.history && data.history.length > 0) {
            data.history.forEach(msg => {
                addMessageToChat(msg.role, msg.content);
            });
        } else {
            clearChat(); // Show placeholder
        }
    } catch (err) {
        console.error('Failed to load chat history:', err);
        clearChat();
    }
}

function copyChatContent() {
    console.log('copyChatContent called'); // Debug
    const chatMsgsEl = document.getElementById('chatMessages');
    if (!chatMsgsEl) {
        console.error('chatMessages element not found');
        alert('채팅 영역을 찾을 수 없습니다.');
        return;
    }

    const msgs = Array.from(chatMsgsEl.querySelectorAll('.chat-message'));
    console.log('Found messages:', msgs.length); // Debug

    // Filter out placeholders
    const realMsgs = msgs.filter(m => !m.querySelector('.bi-chat-quote'));

    if (realMsgs.length === 0) {
        alert('복사할 대화 내용이 없습니다.');
        return;
    }

    let text = "";
    realMsgs.forEach(msg => {
        let role = "System";
        let content = "";

        if (msg.classList.contains('text-end')) {
            role = "User";
            content = msg.innerText.trim();
        } else {
            if (msg.querySelector('.bi-robot')) role = "Assistant";
            else if (msg.querySelector('.bi-exclamation')) role = "Error";
            content = msg.innerText.trim();
        }

        text += `[${role}]\n${content}\n\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
        showToast('복사됨');
    }).catch(err => {
        console.error('Copy failed:', err);
    });
}

function setupSidebarResizeHandler() {
    const resizer = document.getElementById('sidebarResizer');
    const sidebar = document.getElementById('sidebar');
    let isResizing = false;

    if (!resizer || !sidebar) return;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.classList.add('resizing-active'); // Add global class
        document.body.style.cursor = 'col-resize';

        sidebar.style.transition = 'none';

        // Prevent default to avoid text selection start
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        e.preventDefault(); // Prevent selection

        // Account for the 24px sidebar toggle button on the left
        const toggleWidth = 24;
        const newWidth = e.clientX - toggleWidth;

        if (newWidth >= 150 && newWidth <= 500) {
            sidebar.style.width = `${newWidth}px`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.classList.remove('resizing-active');
            document.body.style.cursor = '';
            sidebar.style.transition = 'width 0.3s';
        }
    });
}

// Player position observer (placeholder - no special positioning needed with fixed layout)
function setupPlayerPositionObservers() {
    // This function was called but not defined - stub for compatibility
    // The audio controls bar is now fixed at center bottom via CSS
}

// Transcript Text Modal Functions
function updateTranscriptTextContent() {
    if (segments.length === 0) return;

    const text = segments.map(seg => {
        const start = formatTime(seg.start);
        const end = formatTime(seg.end);
        const speaker = seg.speaker ? `[${seg.speaker}] ` : '';
        return `[${start} - ${end}] ${speaker}${seg.text}`;
    }).join('\n\n');

    const contentEl = document.getElementById('transcriptTextContent');
    if (contentEl) {
        contentEl.textContent = text;
    }
}

function copyTranscriptText() {
    const contentEl = document.getElementById('transcriptTextContent');
    if (!contentEl || !contentEl.textContent) {
        showToast('복사할 내용 없음');
        return;
    }

    navigator.clipboard.writeText(contentEl.textContent).then(() => {
        showToast('복사됨');
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Update speaker dropdown when settings panel is opened
function updateSpeakerDropdown() {
    const speakerSelect = document.getElementById('speakerSelect');
    if (!speakerSelect || segments.length === 0) return;

    const existingSpeakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];

    if (existingSpeakers.length === 0) {
        speakerSelect.innerHTML = '<option value="">화자 없음</option>';
    } else {
        speakerSelect.innerHTML = existingSpeakers.map(s =>
            `<option value="${s}">${s}</option>`
        ).join('');
    }
}

// Listen for settings panel toggle to update speaker dropdown
document.addEventListener('DOMContentLoaded', () => {
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) {
        settingsPanel.addEventListener('show.bs.collapse', () => {
            updateSpeakerDropdown();
        });
    }

    // Listen for transcript text modal open
    const transcriptTextModal = document.getElementById('transcriptTextModal');
    if (transcriptTextModal) {
        transcriptTextModal.addEventListener('show.bs.modal', () => {
            updateTranscriptTextContent();
        });
    }
});

// Toast notification function
function showToast(message, duration = 2000) {
    // Remove existing toast if any
    const existing = document.getElementById('toastNotification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'toastNotification';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(245, 158, 11, 0.95);
        color: #1a1a1a;
        padding: 10px 24px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: 500;
        z-index: 99999;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
    `;

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
    });

    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ============ Recording Functions ============

function setupRecording() {
    const recordBtn = document.getElementById('recordBtn');
    if (!recordBtn) return;

    recordBtn.addEventListener('click', toggleRecording);
}

async function toggleRecording() {
    const recordBtn = document.getElementById('recordBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const audioPreview = document.getElementById('recordedAudioPreview');
    const visualizerContainer = document.getElementById('audioVisualizerContainer');
    const canvas = document.getElementById('audioVisualizer');

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        // Stop recording
        mediaRecorder.stop();
        recordBtn.innerHTML = '<i class="bi bi-circle-fill me-1"></i> 녹음 시작';
        recordBtn.classList.remove('btn-danger');
        recordBtn.classList.add('btn-outline-danger');
        recordingStatus.style.display = 'none';
        visualizerContainer.style.display = 'none';

        // Stop visualizer
        if (window.audioVisualizerAnimationId) {
            cancelAnimationFrame(window.audioVisualizerAnimationId);
            window.audioVisualizerAnimationId = null;
        }

        if (recordingTimerInterval) {
            clearInterval(recordingTimerInterval);
            recordingTimerInterval = null;
        }
    } else {
        // Start recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Setup Audio Visualizer
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            const canvasCtx = canvas.getContext('2d');

            function drawVisualizer() {
                window.audioVisualizerAnimationId = requestAnimationFrame(drawVisualizer);

                analyser.getByteFrequencyData(dataArray);

                canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

                const barWidth = (canvas.width / bufferLength) * 2.5;
                let x = 0;

                for (let i = 0; i < bufferLength; i++) {
                    const barHeight = (dataArray[i] / 255) * canvas.height;

                    // Gradient color from orange to red based on intensity
                    const intensity = dataArray[i] / 255;
                    const r = 245;
                    const g = Math.floor(158 - intensity * 100);
                    const b = 11;

                    canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                    canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

                    x += barWidth + 1;
                    if (x > canvas.width) break;
                }
            }

            drawVisualizer();
            visualizerContainer.style.display = 'block';

            mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
            });
            recordedChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    recordedChunks.push(e.data);
                }
            };

            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType;
                recordedBlob = new Blob(recordedChunks, { type: mimeType });

                // Create preview - show directly
                const audioUrl = URL.createObjectURL(recordedBlob);
                audioPreview.src = audioUrl;
                audioPreview.style.display = 'block';

                // Set file name and mark as selected
                const selectedFileName = document.getElementById('selectedFileName');
                selectedFileName.style.display = 'block';
                selectedFileName.querySelector('span').textContent = `녹음파일_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.webm`;

                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());

                // Close audio context
                audioContext.close();

                showToast('녹음 완료');
            };

            mediaRecorder.start(1000); // Collect data every second
            recordingStartTime = Date.now();

            // Update UI
            recordBtn.innerHTML = '<i class="bi bi-stop-fill me-1"></i> 녹음 중지';
            recordBtn.classList.remove('btn-outline-danger');
            recordBtn.classList.add('btn-danger');
            recordingStatus.style.display = 'block';
            audioPreview.style.display = 'none';

            // Start timer
            updateRecordingTime();
            recordingTimerInterval = setInterval(updateRecordingTime, 1000);

        } catch (err) {
            console.error('Recording error:', err);
            showToast('마이크 접근 권한이 필요합니다');
        }
    }
}

function updateRecordingTime() {
    if (!recordingStartTime) return;

    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const secs = (elapsed % 60).toString().padStart(2, '0');

    const timeEl = document.getElementById('recordingTime');
    if (timeEl) {
        timeEl.textContent = `${mins}:${secs}`;
    }
}

// handleRecordedTranscribe - 녹음된 오디오 전사 처리
async function handleRecordedTranscribe() {
    const formData = new FormData();
    const filename = `녹음_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}.webm`;
    formData.append('audio', recordedBlob, filename);
    formData.append('title', document.getElementById('titleInput').value || '녹음');
    formData.append('participants', document.getElementById('participantsInput').value);
    formData.append('agenda', document.getElementById('agendaInput').value);
    formData.append('language', document.getElementById('languageSelect').value);
    formData.append('enable_diarization', diarizationCheck.checked);
    formData.append('hf_token', document.getElementById('hfTokenInput').value);

    // Show processing
    startBtn.disabled = true;
    processingIndicator.style.display = 'block';

    try {
        const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.success) {
            recordedBlob = null;  // Reset
            recordedChunks = [];
            document.getElementById('recordedAudioPreview').style.display = 'none';
            document.getElementById('selectedFileName').style.display = 'none';
            loadLibrary();
            loadSession(data.session_id);
            showToast('전사 완료!');
        } else {
            showToast('전사 실패: ' + (data.detail || '알 수 없는 오류'));
        }
    } catch (err) {
        console.error('Transcribe error:', err);
        showToast('전사 중 오류가 발생했습니다.');
    } finally {
        startBtn.disabled = false;
        processingIndicator.style.display = 'none';
    }
}

// Initialize recording on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setupRecording();
    setupKeyboardControls();
});

// Keyboard controls for audio player
function setupKeyboardControls() {
    document.addEventListener('keydown', (e) => {
        // 입력 필드에서는 무시
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            return;
        }

        // 플레이어가 없으면 무시
        if (!mainAudio || !mainAudio.src) return;

        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (mainAudio.paused) {
                    mainAudio.play();
                } else {
                    mainAudio.pause();
                }
                break;

            case 'ArrowLeft':
                e.preventDefault();
                mainAudio.currentTime = Math.max(0, mainAudio.currentTime - 5);
                break;

            case 'ArrowRight':
                e.preventDefault();
                mainAudio.currentTime = Math.min(mainAudio.duration, mainAudio.currentTime + 5);
                break;

            case 'ArrowUp':
                e.preventDefault();
                // 이전 세그먼트로 이동
                if (currentActiveIndex > 0) {
                    playSegment(currentActiveIndex - 1);
                }
                break;

            case 'ArrowDown':
                e.preventDefault();
                // 다음 세그먼트로 이동
                if (currentActiveIndex < segments.length - 1) {
                    playSegment(currentActiveIndex + 1);
                }
                break;
        }
    });
}

// ============ Speaker Visualization Orbs ============
// Uses existing speakerColors and speakerColorMap from line 57-61

function renderSpeakerOrbs() {
    const container = document.getElementById('speakerOrbs');
    if (!container) return;

    // Get unique speakers
    const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];

    if (speakers.length === 0) {
        container.innerHTML = '<div class="text-secondary small text-center w-100" style="position: absolute; top: 50%; transform: translateY(-50%);">화자 없음</div>';
        return;
    }

    // Assign colors to speakers (don't reassign, just clear and set)
    Object.keys(speakerColorMap).forEach(key => delete speakerColorMap[key]);
    speakers.forEach((speaker, idx) => {
        speakerColorMap[speaker] = speakerColors[idx % speakerColors.length];
    });

    // Get container dimensions for positioning
    const containerRect = container.getBoundingClientRect();
    const orbSize = 50;
    const padding = 10;

    // Generate orbs with random positions
    container.innerHTML = speakers.map((speaker, idx) => {
        const color = speakerColorMap[speaker];
        // Calculate initial position (spread out)
        const maxX = Math.max(20, containerRect.width - orbSize - padding);
        const maxY = Math.max(20, containerRect.height - orbSize - padding);
        const x = padding + (idx % 3) * 60 + Math.random() * 20;
        const y = padding + Math.floor(idx / 3) * 60 + Math.random() * 20;

        return `
            <div class="speaker-orb" 
                 data-speaker="${escapeHtml(speaker)}" 
                 style="background: ${color}; color: ${color}; left: ${Math.min(x, maxX)}px; top: ${Math.min(y, maxY)}px;"
                 title="${escapeHtml(speaker)}">
            </div>
        `;
    }).join('');

    // Add drag handlers
    container.querySelectorAll('.speaker-orb').forEach(orb => {
        makeDraggable(orb, container);
    });

    // Set initial orb sizes based on container
    setTimeout(() => updateOrbSizes(), 50);
}

// Make orb draggable within container
function makeDraggable(orb, container) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    orb.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = orb.offsetLeft;
        initialTop = orb.offsetTop;
        orb.style.zIndex = '100';
        orb.style.transition = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const containerRect = container.getBoundingClientRect();
        const orbSize = orb.offsetWidth;

        let newLeft = initialLeft + dx;
        let newTop = initialTop + dy;

        // Constrain to container
        newLeft = Math.max(0, Math.min(newLeft, containerRect.width - orbSize));
        newTop = Math.max(0, Math.min(newTop, containerRect.height - orbSize));

        orb.style.left = newLeft + 'px';
        orb.style.top = newTop + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            orb.style.zIndex = '';
            orb.style.transition = '';
        }
    });
}

function updateSpeakingOrb(speakerName) {
    const container = document.getElementById('speakerOrbs');
    if (!container) return;

    // Remove speaking class from all orbs
    container.querySelectorAll('.speaker-orb').forEach(orb => {
        orb.classList.remove('speaking');
    });

    // Add speaking class to current speaker's orb
    if (speakerName) {
        const activeOrb = container.querySelector(`[data-speaker="${speakerName}"]`);
        if (activeOrb) {
            activeOrb.classList.add('speaking');
        }
    }
}

// Toggle speaker orbs floating panel
function toggleSpeakerOrbsPanel() {
    const panel = document.getElementById('speakerOrbsPanel');
    const btn = document.getElementById('speakerOrbsToggle');

    if (!panel) return;

    const isVisible = panel.style.display !== 'none';
    panel.style.display = isVisible ? 'none' : 'block';

    if (btn) {
        btn.classList.toggle('active', !isVisible);
    }

    // Render orbs when showing
    if (!isVisible && typeof renderSpeakerOrbs === 'function') {
        renderSpeakerOrbs();
    }
}

// Initialize speaker orbs toggle button and panel dragging
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('speakerOrbsToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSpeakerOrbsPanel);
    }

    // Make panel draggable by header
    const panel = document.getElementById('speakerOrbsPanel');
    const header = document.getElementById('speakerOrbsPanelHeader');

    if (panel && header) {
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('btn-close')) return; // Don't drag on close button
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            panel.style.left = (initialX + dx) + 'px';
            panel.style.top = (initialY + dy) + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Resize observer for dynamic orb sizing
        const resizeObserver = new ResizeObserver(() => {
            updateOrbSizes();
        });
        resizeObserver.observe(panel);
    }
});

// Update orb sizes based on container size
function updateOrbSizes() {
    const container = document.getElementById('speakerOrbs');
    if (!container) return;

    const orbs = container.querySelectorAll('.speaker-orb');
    if (orbs.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const minDim = Math.min(containerRect.width, containerRect.height);

    // Calculate orb size based on container and number of orbs
    const baseSize = Math.max(30, Math.min(80, minDim / Math.sqrt(orbs.length) - 10));

    orbs.forEach(orb => {
        orb.style.width = baseSize + 'px';
        orb.style.height = baseSize + 'px';
    });
}
