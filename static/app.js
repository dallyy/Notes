// ═══════════════════════════════════════════════════════════════
// Notes App — state & logic (refactored)
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  // ── state ────────────────────────────────────────────────────
  let notes = [];
  let currentNoteId = null;
  let settings = {
    background_image: null,
    blur: 0,
    transparency: 1.0,
    theme: "cyan",
  };
  let isPreview = false;
  let saveTimer = null;
  let saving = false;
  let lastSavedTitle = "";
  let lastSavedContent = "";
  let searchQuery = "";

  // ── folder state (persisted in localStorage) ─────────────────
  let folders = [];        // [{id, name, createdAt}]
  let noteFolder = {};     // noteId -> folderId
  let expandedFolders = {}; // folderId -> true
  const FOLDERS_KEY = "notes-folders";
  const EXPANDED_KEY = "notes-folders-expanded";

  // ── visual effect instances ──────────────────────────────────
  let sideRays = null;
  let splashCursor = null;
  let clickSpark = null;

  const THEME_COLORS = {
    cyan:    { c1: "#22d3ee", c2: "#06b6d4", cursor: "#dd2c11" },
    emerald: { c1: "#34d399", c2: "#10b981", cursor: "#cb2c66" },
    violet:  { c1: "#a78bfa", c2: "#8b5cf6", cursor: "#587405" },
    rose:    { c1: "#fb7185", c2: "#f43f5e", cursor: "#048e7a" },
    amber:   { c1: "#fbbf24", c2: "#f59e0b", cursor: "#0440db" },
  };

  // ── dom refs ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const bgLayer        = document.getElementById("bgLayer");
  const noteList       = document.getElementById("noteList");
  const editorActive   = document.getElementById("editorActive");
  const editorPlaceholder = document.getElementById("editorPlaceholder");
  const noteTitle      = document.getElementById("noteTitle");
  const noteContent    = document.getElementById("noteContent");
  const notePreview    = document.getElementById("notePreview");
  const editorMeta     = document.getElementById("editorMeta");
  const settingsPanel  = document.getElementById("settingsPanel");
  const settingsOverlay= document.getElementById("settingsOverlay");
  const blurSlider     = document.getElementById("blurSlider");
  const transSlider    = document.getElementById("transSlider");
  const blurVal        = document.getElementById("blurVal");
  const transVal       = document.getElementById("transVal");
  const themeSelect    = document.getElementById("themeSelect");
  const bgUpload       = document.getElementById("bgUpload");
  const searchInput    = document.getElementById("searchNotes");
  const confirmOverlay = document.getElementById("confirmOverlay");
  const sidebar        = document.getElementById("sidebar");
  const sidebarBackdrop= document.getElementById("sidebarBackdrop");
  const toastContainer = document.getElementById("toastContainer");
  const folderDialogOverlay = document.getElementById("folderDialogOverlay");
  const folderDialogInput   = document.getElementById("folderDialogInput");
  const folderDialogOk      = document.getElementById("folderDialogOk");
  const folderDialogCancel  = document.getElementById("folderDialogCancel");

  // ── toast notifications ──────────────────────────────────────
  function showToast(message, type) {
    type = type || "info";
    const el = document.createElement("div");
    el.className = "toast toast--" + type;
    el.textContent = message;
    toastContainer.appendChild(el);

    setTimeout(function () {
      el.classList.add("removing");
      el.addEventListener("animationend", function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    }, 3000);
  }

  // ── loading state ────────────────────────────────────────────
  function setLoading(on) {
    if (on) {
      editorPlaceholder.innerHTML =
        '<div class="loading-spinner"><div class="spinner"></div></div>';
    } else {
      editorPlaceholder.innerHTML =
        '<p>选择一个笔记或按 <kbd>Ctrl+N</kbd> 创建新笔记</p>';
    }
  }

  // ── confirm dialog ───────────────────────────────────────────
  function showConfirm(message) {
    return new Promise(function (resolve) {
      document.getElementById("confirmTitle").textContent = message;
      confirmOverlay.hidden = false;
      function cleanup() {
        confirmOverlay.hidden = true;
        document.getElementById("confirmOk").removeEventListener("click", onOk);
        document.getElementById("confirmCancel").removeEventListener("click", onCancel);
      }
      function onOk()    { cleanup(); resolve(true); }
      function onCancel(){ cleanup(); resolve(false); }
      document.getElementById("confirmOk").addEventListener("click", onOk);
      document.getElementById("confirmCancel").addEventListener("click", onCancel);
    });
  }

  // ── folder state & persistence ───────────────────────────────
  function loadFolderState() {
    try {
      var saved = JSON.parse(localStorage.getItem(FOLDERS_KEY) || "{}");
      folders = Array.isArray(saved.folders) ? saved.folders : [];
      noteFolder = saved.noteFolder || {};
    } catch (e) {
      folders = [];
      noteFolder = {};
    }
    try {
      expandedFolders = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "{}");
    } catch (e) {
      expandedFolders = {};
    }
  }

  function saveFolderState() {
    localStorage.setItem(
      FOLDERS_KEY,
      JSON.stringify({ folders: folders, noteFolder: noteFolder })
    );
  }

  function saveExpanded() {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(expandedFolders));
  }

  function folderById(id) {
    for (var i = 0; i < folders.length; i++) {
      if (folders[i].id === id) return folders[i];
    }
    return null;
  }

  function genFolderId() {
    return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function folderNoteCount(id) {
    var count = 0;
    for (var key in noteFolder) {
      if (noteFolder[key] === id) count++;
    }
    return count;
  }

  // ── settings drawer ──────────────────────────────────────────
  function openSettings() {
    settingsPanel.classList.add("open");
    settingsOverlay.classList.add("open");
  }
  function closeSettings() {
    settingsPanel.classList.remove("open");
    settingsOverlay.classList.remove("open");
  }
  document.getElementById("btnToggleSettings").addEventListener("click", openSettings);
  document.getElementById("settingsClose").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", closeSettings);

  // ── sidebar toggle (mobile) ──────────────────────────────────
  document.getElementById("sidebarToggle").addEventListener("click", function () {
    sidebar.classList.toggle("open");
    sidebarBackdrop.classList.toggle("open");
  });
  sidebarBackdrop.addEventListener("click", function () {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
  });

  // ── effect initializers ──────────────────────────────────────
  function initSideRays(theme) {
    var container = document.getElementById("raysLayer");
    if (!container) return;
    if (sideRays) { sideRays.destroy(); sideRays = null; }
    var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
    sideRays = new SideRays(container, {
      speed: 2.5, rayColor1: c.c1, rayColor2: c.c2,
      intensity: 3, spread: 2, origin: "top-right", tilt: 0,
      saturation: 1.5, blend: 0.75, falloff: 1.2, opacity: 1,
    });
    try { sideRays.start(); } catch (e) { /* WebGL unavailable */ }
  }

  function updateSideRaysTheme(theme) {
    if (!sideRays) return;
    var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
    sideRays.update({ rayColor1: c.c1, rayColor2: c.c2 });
  }

  function initSplashCursor(theme) {
    var container = document.getElementById("cursorLayer");
    if (!container) return;
    if (splashCursor) { splashCursor.destroy(); splashCursor = null; }
    var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
    splashCursor = new SplashCursor(container, {
      COLOR: c.cursor, RAINBOW_MODE: false, SHADING: true,
      CURL: 3, SPLAT_FORCE: 6000,
    });
    try { splashCursor.start(); } catch (e) { /* WebGL unavailable */ }
  }

  function updateSplashCursorTheme(theme) {
    if (!splashCursor) return;
    var c = THEME_COLORS[theme] || THEME_COLORS.cyan;
    splashCursor.updateColor(c.cursor);
  }

  function initClickSpark() {
    var container = document.getElementById("sparkLayer");
    if (!container) return;
    if (clickSpark) { clickSpark.destroy(); clickSpark = null; }
    clickSpark = new ClickSpark(container, {
      sparkColor: "#6d28d9", sparkSize: 14, sparkRadius: 30,
      sparkCount: 8, duration: 450,
    });
    clickSpark.start();
  }

  function updateClickSparkTheme() {
    if (!clickSpark) return;
    clickSpark.updateColor("#6d28d9");
  }

  // ── api ──────────────────────────────────────────────────────
  async function api(path, options) {
    var res = await fetch(path, options);
    if (!res.ok) {
      var msg = await res.text().catch(function () { return "请求失败"; });
      throw new Error(msg);
    }
    return res.json();
  }

  async function apiSafe(path, options, errorMsg) {
    try {
      return await api(path, options);
    } catch (e) {
      showToast(errorMsg || "操作失败: " + e.message, "error");
      return null;
    }
  }

  // ── markdown rendering ───────────────────────────────────────
  function renderMarkdown(text) {
    if (typeof katex === "undefined") return marked.parse(text);

    var blocks = [];

    // protect code
    text = text.replace(/(```[\s\S]*?```|`[^`]*`)/g, function (m) {
      blocks.push(m);
      return "\x00CODE" + (blocks.length - 1) + "\x00";
    });

    // display math $$...$$
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, math) {
      blocks.push({ math: math.trim(), display: true });
      return "\x00MATH" + (blocks.length - 1) + "\x00";
    });

    // inline math $...$
    text = text.replace(/\$([^\$\n]+?)\$/g, function (_, math) {
      blocks.push({ math: math.trim(), display: false });
      return "\x00MATH" + (blocks.length - 1) + "\x00";
    });

    var html = marked.parse(text);

    html = html.replace(/\x00(CODE|MATH)(\d+)\x00/g, function (_, type, i) {
      var item = blocks[parseInt(i)];
      if (type === "CODE") return item;
      try {
        return katex.renderToString(item.math, {
          displayMode: item.display,
          throwOnError: false,
        });
      } catch (e) {
        return "<code>" + item.math + "</code>";
      }
    });

    return html;
  }

  // ── notes crud ───────────────────────────────────────────────
  async function loadNotes() {
    setLoading(true);
    var result = await apiSafe("/api/notes", {}, "加载笔记失败");
    setLoading(false);
    if (result) {
      notes = result;
      renderNoteList();
    }
  }

  const DND_TYPE = "application/x-notes-folder";

  function readDragData(e) {
    var raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (err) { return null; }
  }

  function makeNoteItem(n, inFolder) {
    var li = document.createElement("li");
    li.textContent = n.title || "未命名";
    li.dataset.id = n.id;
    li.classList.add("border-glow");
    if (inFolder) li.classList.add("note-in-folder");
    if (n.id === currentNoteId) li.classList.add("active");
    li.draggable = true;
    li.addEventListener("click", function () { selectNote(n.id); });
    li.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "note", id: n.id }));
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", function () { li.classList.remove("dragging"); });
    return li;
  }

  function renderNoteList() {
    noteList.innerHTML = "";
    var q = searchQuery.trim().toLowerCase();

    var matches = function (n) {
      if (!q) return true;
      return (n.title || "未命名").toLowerCase().indexOf(q) !== -1;
    };
    var sortByUpdated = function (a, b) {
      return new Date(b.updated_at) - new Date(a.updated_at);
    };

    var visible = notes.filter(matches);

    // group notes by folder (ignore stale folder refs)
    var byFolder = {};
    var rootNotes = [];
    visible.forEach(function (n) {
      var fid = noteFolder[n.id];
      if (fid && folderById(fid)) {
        (byFolder[fid] = byFolder[fid] || []).push(n);
      } else {
        rootNotes.push(n);
      }
    });
    rootNotes.sort(sortByUpdated);

    var visibleCount = rootNotes.length;
    var sortedFolders = folders.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
    });

    sortedFolders.forEach(function (f) {
      var fNotes = (byFolder[f.id] || []).slice().sort(sortByUpdated);
      visibleCount += fNotes.length;
      if (q && fNotes.length === 0) return; // hide empty folders while searching

      noteList.appendChild(makeFolderRow(f));
      if ((q ? true : expandedFolders[f.id]) && fNotes.length) {
        fNotes.forEach(function (n) {
          noteList.appendChild(makeNoteItem(n, true));
        });
      }
    });

    // root (top-level) notes
    rootNotes.forEach(function (n) {
      noteList.appendChild(makeNoteItem(n, false));
    });

    if (visibleCount === 0) {
      var empty = document.createElement("div");
      empty.className = "note-list-empty";
      empty.textContent = q ? "无匹配笔记" : "暂无笔记，点击上方按钮创建";
      noteList.appendChild(empty);
    }

    // re-collect border-glow elements for cursor tracking
    collectGlowElements();
  }

  function makeFolderRow(f) {
    var expanded = searchQuery.trim() ? true : !!expandedFolders[f.id];
    var count = folderNoteCount(f.id);

    var row = document.createElement("li");
    row.className = "folder-row border-glow";
    row.draggable = true;
    row.dataset.folderId = f.id;

    var caret = document.createElement("span");
    caret.className = "folder-caret";
    caret.textContent = expanded ? "▾" : "▸";

    var icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.textContent = "\u{1F4C1}";

    var name = document.createElement("span");
    name.className = "folder-name";
    name.textContent = f.name || "未命名文件夹";
    name.title = f.name || "";

    var countEl = document.createElement("span");
    countEl.className = "folder-count";
    countEl.textContent = count;

    var del = document.createElement("button");
    del.className = "folder-delete";
    del.type = "button";
    del.title = "删除文件夹（笔记移到顶层）";
    del.setAttribute("aria-label", "删除文件夹");
    del.textContent = "✕";

    row.appendChild(caret);
    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(countEl);
    row.appendChild(del);

    // toggle expand
    row.addEventListener("click", function () {
      if (searchQuery.trim()) return; // folders are forced open during search
      expandedFolders[f.id] = !expandedFolders[f.id];
      saveExpanded();
      renderNoteList();
    });

    // rename on double click
    name.addEventListener("dblclick", function (e) {
      e.stopPropagation();
      startRenameFolder(f, name);
    });

    // delete folder
    del.addEventListener("click", function (e) {
      e.stopPropagation();
      deleteFolder(f.id);
    });

    // drag & drop — folders are both draggable and drop targets
    row.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData(DND_TYPE, JSON.stringify({ type: "folder", id: f.id }));
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", function () { row.classList.remove("dragging"); });
    row.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", function () { row.classList.remove("drag-over"); });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("drag-over");
      var data = readDragData(e);
      if (!data) return;
      if (data.type === "note") {
        moveNoteToFolder(data.id, f.id);
      } else if (data.type === "folder") {
        mergeFolders(data.id, f.id);
      }
    });

    return row;
  }

  async function selectNote(id) {
    currentNoteId = id;
    var note = notes.find(function (n) { return n.id === id; });
    if (!note) return;

    noteTitle.value = note.title;
    noteContent.value = note.content;
    noteTitle.classList.toggle("has-content", note.title.length > 0);

    // track for change detection
    lastSavedTitle = note.title;
    lastSavedContent = note.content;

    // exit preview mode
    isPreview = false;
    var btn = document.getElementById("btnPreview");
    btn.textContent = "预览";
    btn.classList.remove("active");

    editorMeta.textContent = "更新于 " + formatDate(note.updated_at);
    editorPlaceholder.hidden = true;
    editorActive.hidden = false;

    // scroll-reveal animation
    editorActive.classList.remove("revealing");
    void editorActive.offsetWidth; // force reflow
    editorActive.classList.add("revealing");
    setTimeout(function () { editorActive.classList.remove("revealing"); }, 900);

    renderNoteList();
  }

  async function createNote() {
    var note = await apiSafe(
      "/api/notes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", content: "" }),
      },
      "创建笔记失败"
    );
    if (!note) return;
    notes.push(note);
    lastSavedTitle = "";
    lastSavedContent = "";
    selectNote(note.id);
    showToast("笔记已创建", "success");
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString();
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrentNote, 600);
  }

  async function saveCurrentNote() {
    if (!currentNoteId) return;
    if (saving) {
      // re-schedule: try again after current save finishes
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCurrentNote, 800);
      return;
    }

    var title = noteTitle.value;
    var content = noteContent.value;

    // skip if nothing changed
    if (title === lastSavedTitle && content === lastSavedContent) return;

    saving = true;
    var updated = await apiSafe(
      "/api/notes/" + currentNoteId,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title, content: content }),
      },
      "保存失败"
    );
    saving = false;

    if (!updated) return;

    lastSavedTitle = updated.title;
    lastSavedContent = updated.content;
    var idx = notes.findIndex(function (n) { return n.id === currentNoteId; });
    if (idx !== -1) notes[idx] = updated;
    editorMeta.textContent = "更新于 " + formatDate(updated.updated_at);
    renderNoteList();
  }

  async function deleteNote() {
    if (!currentNoteId) return;
    var confirmed = await showConfirm("确定要删除这条笔记吗？此操作无法撤销。");
    if (!confirmed) return;

    var result = await apiSafe(
      "/api/notes/" + currentNoteId,
      { method: "DELETE" },
      "删除失败"
    );
    if (!result) return;

    var deletedId = currentNoteId;
    notes = notes.filter(function (n) { return n.id !== deletedId; });
    delete noteFolder[deletedId];
    saveFolderState();
    currentNoteId = null;
    lastSavedTitle = "";
    lastSavedContent = "";
    noteTitle.value = "";
    noteContent.value = "";
    noteTitle.classList.remove("has-content");
    editorPlaceholder.hidden = false;
    editorActive.hidden = true;
    renderNoteList();
    showToast("笔记已删除", "info");
  }

  // ── folder operations ────────────────────────────────────────
  function createFolder(name) {
    var folder = { id: genFolderId(), name: name, createdAt: new Date().toISOString() };
    folders.push(folder);
    expandedFolders[folder.id] = true;
    saveFolderState();
    saveExpanded();
    renderNoteList();
    showToast("文件夹已创建", "success");
  }

  function moveNoteToFolder(noteId, folderId) {
    if (noteFolder[noteId] === folderId) return;
    noteFolder[noteId] = folderId;
    expandedFolders[folderId] = true;
    saveFolderState();
    saveExpanded();
    renderNoteList();
    showToast("已移动到文件夹", "info");
  }

  async function mergeFolders(srcId, targetId) {
    if (srcId === targetId) return;
    var src = folderById(srcId);
    var tgt = folderById(targetId);
    if (!src || !tgt) return;
    var confirmed = await showConfirm(
      "确定要把文件夹「" + (src.name || "") + "」合并到「" + (tgt.name || "") +
      "」吗？\n其中 " + folderNoteCount(srcId) +
      " 条笔记会移入「" + (tgt.name || "") + "」，源文件夹将被删除。"
    );
    if (!confirmed) return;
    for (var key in noteFolder) {
      if (noteFolder[key] === srcId) noteFolder[key] = targetId;
    }
    folders = folders.filter(function (x) { return x.id !== srcId; });
    delete expandedFolders[srcId];
    expandedFolders[targetId] = true;
    saveFolderState();
    saveExpanded();
    renderNoteList();
    showToast("已合并到「" + (tgt.name || "") + "」", "success");
  }

  async function deleteFolder(id) {
    var f = folderById(id);
    if (!f) return;
    var confirmed = await showConfirm(
      "确定要删除文件夹「" + (f.name || "") + "」吗？\n其中的笔记会移到顶层，不会被删除。"
    );
    if (!confirmed) return;
    for (var key in noteFolder) {
      if (noteFolder[key] === id) delete noteFolder[key];
    }
    folders = folders.filter(function (x) { return x.id !== id; });
    delete expandedFolders[id];
    saveFolderState();
    saveExpanded();
    renderNoteList();
    showToast("文件夹已删除", "info");
  }

  function startRenameFolder(f, nameEl) {
    nameEl.contentEditable = "true";
    nameEl.classList.add("editing");
    nameEl.focus();
    var range = document.createRange();
    range.selectNodeContents(nameEl);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    var done = false;
    function commit() {
      if (done) return;
      done = true;
      nameEl.contentEditable = "false";
      nameEl.classList.remove("editing");
      var newName = (nameEl.textContent || "").trim();
      if (newName && newName !== f.name) {
        f.name = newName;
        saveFolderState();
        renderNoteList();
        showToast("文件夹已重命名", "info");
      } else if (!newName) {
        nameEl.textContent = f.name;
      }
    }
    nameEl.addEventListener("blur", commit);
    nameEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        nameEl.blur();
      } else if (e.key === "Escape") {
        nameEl.textContent = f.name;
        commit();
      }
    });
  }

  // ── folder dialog ────────────────────────────────────────────
  function openFolderDialog() {
    folderDialogOverlay.hidden = false;
    folderDialogInput.value = "";
    setTimeout(function () { folderDialogInput.focus(); }, 0);
  }
  function closeFolderDialog() {
    folderDialogOverlay.hidden = true;
  }
  function confirmCreateFolder() {
    var name = folderDialogInput.value.trim();
    if (!name) { folderDialogInput.focus(); return; }
    closeFolderDialog();
    createFolder(name);
  }
  document.getElementById("btnNewFolder").addEventListener("click", openFolderDialog);
  folderDialogOk.addEventListener("click", confirmCreateFolder);
  folderDialogCancel.addEventListener("click", closeFolderDialog);
  folderDialogInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") confirmCreateFolder();
    else if (e.key === "Escape") closeFolderDialog();
  });
  folderDialogOverlay.addEventListener("click", function (e) {
    if (e.target === folderDialogOverlay) closeFolderDialog();
  });

  // drag a note onto empty sidebar area → move back to top level
  noteList.addEventListener("dragover", function (e) {
    if (e.target === noteList) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      noteList.classList.add("drag-over-root");
    }
  });
  noteList.addEventListener("dragleave", function (e) {
    if (e.target === noteList) noteList.classList.remove("drag-over-root");
  });
  noteList.addEventListener("drop", function (e) {
    if (e.target !== noteList) return;
    e.preventDefault();
    noteList.classList.remove("drag-over-root");
    var data = readDragData(e);
    if (data && data.type === "note" && noteFolder[data.id]) {
      delete noteFolder[data.id];
      saveFolderState();
      renderNoteList();
      showToast("已移到顶层", "info");
    }
  });

  // ── settings ─────────────────────────────────────────────────
  async function loadSettings() {
    var s = await apiSafe("/api/settings", {}, "加载设置失败");
    if (!s) return;
    settings = s;
    applySettings();
    blurSlider.value = settings.blur;
    transSlider.value = settings.transparency;
    blurVal.textContent = settings.blur + "px";
    transVal.textContent = settings.transparency.toFixed(2);
    initSideRays(settings.theme || "cyan");
    initSplashCursor(settings.theme || "cyan");
    initClickSpark();
  }

  function applySettings() {
    bgLayer.style.filter = "blur(" + settings.blur + "px)";
    bgLayer.style.opacity = settings.transparency;
    if (settings.background_image) {
      bgLayer.style.backgroundImage =
        "url(/uploads/" + settings.background_image + ")";
    } else {
      bgLayer.style.backgroundImage = "";
    }
    document.body.dataset.theme = settings.theme || "cyan";
    themeSelect.value = settings.theme || "cyan";
    updateSideRaysTheme(settings.theme || "cyan");
    updateSplashCursorTheme(settings.theme || "cyan");
    updateClickSparkTheme();
  }

  async function updateSettings() {
    var blur = parseInt(blurSlider.value);
    var transparency = parseFloat(transSlider.value);
    var s = await apiSafe(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blur: blur, transparency: transparency }),
      },
      "更新设置失败"
    );
    if (!s) return;
    settings = s;
    applySettings();
    blurVal.textContent = settings.blur + "px";
    transVal.textContent = settings.transparency.toFixed(2);
  }

  async function saveTheme() {
    var theme = themeSelect.value;
    var s = await apiSafe(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: theme }),
      },
      "切换主题失败"
    );
    if (!s) return;
    settings = s;
    document.body.dataset.theme = theme;
    updateSideRaysTheme(theme);
    updateSplashCursorTheme(theme);
    updateClickSparkTheme();
  }

  async function uploadBackground(file) {
    var form = new FormData();
    form.append("file", file);
    var result = await apiSafe(
      "/api/upload-background",
      { method: "POST", body: form },
      "上传背景失败"
    );
    if (!result) return;
    settings.background_image = result.filename;
    applySettings();
    showToast("背景已更新", "success");
  }

  async function removeBackground() {
    var result = await apiSafe(
      "/api/background",
      { method: "DELETE" },
      "移除背景失败"
    );
    if (!result) return;
    settings.background_image = null;
    applySettings();
    showToast("背景已移除", "info");
  }

  // ── search ───────────────────────────────────────────────────
  var searchDebounce = null;
  searchInput.addEventListener("input", function () {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      searchQuery = searchInput.value;
      renderNoteList();
    }, 200);
  });

  // ── event bindings ────────────────────────────────────────────
  document.getElementById("btnNewNote").addEventListener("click", createNote);
  document.getElementById("btnSave").addEventListener("click", saveCurrentNote);
  document.getElementById("btnDelete").addEventListener("click", deleteNote);

  // preview toggle — CSS :has() handles display switching
  document.getElementById("btnPreview").addEventListener("click", function () {
    isPreview = !isPreview;
    var btn = document.getElementById("btnPreview");
    if (isPreview) {
      notePreview.innerHTML = renderMarkdown(noteContent.value || "*暂无内容*");
      btn.textContent = "编辑";
      btn.classList.add("active");
    } else {
      btn.textContent = "预览";
      btn.classList.remove("active");
    }
  });

  noteTitle.addEventListener("input", function () {
    scheduleSave();
    noteTitle.classList.toggle("has-content", noteTitle.value.length > 0);
  });
  noteContent.addEventListener("input", scheduleSave);

  blurSlider.addEventListener("input", function () {
    blurVal.textContent = blurSlider.value + "px";
  });
  transSlider.addEventListener("input", function () {
    transVal.textContent = parseFloat(transSlider.value).toFixed(2);
  });
  blurSlider.addEventListener("change", updateSettings);
  transSlider.addEventListener("change", updateSettings);

  bgUpload.addEventListener("change", function () {
    var file = bgUpload.files[0];
    if (file) uploadBackground(file);
  });

  themeSelect.addEventListener("change", saveTheme);
  document.getElementById("btnRemoveBg").addEventListener("click", removeBackground);

  // keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "n") {
      e.preventDefault();
      createNote();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveCurrentNote();
    }
    // Escape closes settings drawer
    if (e.key === "Escape" && settingsPanel.classList.contains("open")) {
      closeSettings();
    }
  });

  // ── border glow — throttled cursor tracking ──────────────────
  var glowEls = [];
  var glowTicking = false;
  var mouseX = 0, mouseY = 0;

  function collectGlowElements() {
    glowEls = document.querySelectorAll(".border-glow");
  }
  collectGlowElements();

  document.addEventListener("mousemove", function (e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!glowTicking) {
      glowTicking = true;
      requestAnimationFrame(updateGlow);
    }
  });

  function updateGlow() {
    for (var i = 0; i < glowEls.length; i++) {
      var el = glowEls[i];
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = mouseX - cx;
      var dy = mouseY - cy;
      var nearX = Math.max(0, Math.abs(dx) - r.width / 2) / 60;
      var nearY = Math.max(0, Math.abs(dy) - r.height / 2) / 60;
      var proximity = Math.max(0, 100 - Math.max(nearX, nearY) * 100);
      var angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
      el.style.setProperty("--edge-proximity", proximity.toFixed(1));
      el.style.setProperty("--cursor-angle", angle.toFixed(1) + "deg");
    }
    glowTicking = false;
  }

  // ── sidebar resize ────────────────────────────────────────────
  (function () {
    var sidebarEl  = document.getElementById("sidebar");
    var resizerEl  = document.getElementById("sidebarResizer");
    if (!sidebarEl || !resizerEl) return;

    var MIN_W = 180, MAX_W = 500, W_KEY = "sidebar-width";

    var savedW = localStorage.getItem(W_KEY);
    if (savedW) {
      var w = parseInt(savedW, 10);
      if (w >= MIN_W && w <= MAX_W) sidebarEl.style.width = w + "px";
    }

    var drag = { on: false, sx: 0, sw: 0 };

    resizerEl.addEventListener("mousedown", function (e) {
      e.preventDefault();
      drag.on = true;
      drag.sx = e.clientX;
      drag.sw = parseInt(getComputedStyle(sidebarEl).width, 10);
      resizerEl.classList.add("active");
      document.body.classList.add("resizing");
    });

    document.addEventListener("mousemove", function (e) {
      if (!drag.on) return;
      var w = Math.max(MIN_W, Math.min(MAX_W, drag.sw + e.clientX - drag.sx));
      sidebarEl.style.width = w + "px";
    });

    document.addEventListener("mouseup", function () {
      if (!drag.on) return;
      drag.on = false;
      resizerEl.classList.remove("active");
      document.body.classList.remove("resizing");
      localStorage.setItem(
        W_KEY,
        parseInt(getComputedStyle(sidebarEl).width, 10)
      );
    });
  })();

  // ── init ──────────────────────────────────────────────────────
  loadFolderState();
  loadNotes();
  loadSettings();
})();
