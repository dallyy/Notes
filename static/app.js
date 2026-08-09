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
    brightness: 1.0,
    mode: "light",
  };

  // brightness + light/dark mode live in localStorage (no server compiler here)
  const BRIGHTNESS_KEY = "notes-bg-brightness";
  const MODE_KEY = "notes-mode";
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
  const brightnessSlider = document.getElementById("brightnessSlider");
  const brightnessVal  = document.getElementById("brightnessVal");
  const modeSelect     = document.getElementById("modeSelect");
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

  // ── wiki links ───────────────────────────────────────────────
  function parseWikiLink(raw) {
    var pipeIdx = raw.indexOf("|");
    var title = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
    var alias = pipeIdx >= 0 ? raw.slice(pipeIdx + 1) : null;
    var hashIdx = title.indexOf("#");
    if (hashIdx >= 0) title = title.slice(0, hashIdx);
    return { title: title.trim(), alias: (alias || "").trim() };
  }

  // normalize title for matching (strip punctuation/spaces so 图RAG ~ 图-RAG)
  function normTitle(s) {
    return String(s).toLowerCase().replace(/[^一-鿿A-Za-z0-9]/g, "");
  }

  function findNoteByTitle(title) {
    var t = normTitle(title);
    if (!t) return null;
    var best = null;
    for (var i = 0; i < notes.length; i++) {
      var nt = normTitle(notes[i].title || "未命名");
      if (nt === t) return notes[i];
      if (nt.indexOf(t) !== -1 || t.indexOf(nt) !== -1) {
        if (!best || nt.length < normTitle(best.title || "未命名").length) best = notes[i];
      }
    }
    return best;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── markdown rendering ───────────────────────────────────────
  function renderMarkdown(text) {
    var blocks = [];

    // protect code so [[...]] / $..$ inside code blocks are left alone
    text = text.replace(/(```[\s\S]*?```|`[^`]*`)/g, function (m) {
      blocks.push(m);
      return "\x00CODE" + (blocks.length - 1) + "\x00";
    });

    // wiki links [[Title]] / [[Title|alias]] — link to matching note
    text = text.replace(/\[\[([^\]]+)\]\]/g, function (_, raw) {
      var link = parseWikiLink(raw);
      if (!link.title) return _;
      var note = findNoteByTitle(link.title);
      var label = link.alias || link.title;
      var cls = note ? "note-link" : "note-link note-link--unresolved";
      var attrs = note
        ? ' data-note="' + note.id + '"'
        : ' data-title="' + escapeHtml(link.title) + '"';
      return '<a class="' + cls + '" href="#"' + attrs + ">" +
        escapeHtml(label) + "</a>";
    });

    if (typeof katex !== "undefined") {
      var stashMath = function (math, display) {
        blocks.push({ math: math.trim(), display: display });
        return "\x00MATH" + (blocks.length - 1) + "\x00";
      };

      // display math $$...$$ and \[...\]
      text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, math) {
        return stashMath(math, true);
      });
      text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (_, math) {
        return stashMath(math, true);
      });

      // inline math $...$ and \(...\)
      text = text.replace(/\$([^\$\n]+?)\$/g, function (_, math) {
        return stashMath(math, false);
      });
      text = text.replace(/\\\(([^\n]*?)\\\)/g, function (_, math) {
        return stashMath(math, false);
      });
    }

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
    var span = document.createElement("span");
    span.className = "note-title";
    span.textContent = n.title || "未命名";
    li.appendChild(span);
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

  async function selectNote(id, openPreview) {
    currentNoteId = id;
    var note = notes.find(function (n) { return n.id === id; });
    if (!note) return;

    noteTitle.value = note.title;
    noteContent.value = note.content;
    noteTitle.classList.toggle("has-content", note.title.length > 0);
    closeSuggest(); // dropdown must not linger when switching notes

    // track for change detection
    lastSavedTitle = note.title;
    lastSavedContent = note.content;

    // preview mode by default (reading-first); openPreview=false → edit
    var btn = document.getElementById("btnPreview");
    if (openPreview !== false) {
      isPreview = true;
      btn.textContent = "编辑";
      btn.classList.add("active");
      notePreview.innerHTML = renderMarkdown(note.content || "*暂无内容*");
    } else {
      isPreview = false;
      btn.textContent = "预览";
      btn.classList.remove("active");
    }

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
    selectNote(note.id, false); // new empty note → stay in edit mode
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
    loadLocalUiSettings();
    applySettings();
    blurSlider.value = settings.blur;
    transSlider.value = settings.transparency;
    blurVal.textContent = settings.blur + "px";
    transVal.textContent = settings.transparency.toFixed(2);
    brightnessSlider.value = settings.brightness;
    brightnessVal.textContent = Number(settings.brightness).toFixed(2);
    modeSelect.value = settings.mode;
    initSideRays(settings.theme || "cyan");
    initSplashCursor(settings.theme || "cyan");
    initClickSpark();
  }

  // brightness + mode are stored in localStorage, not the server; re-inject
  // them after any server response replaces the settings object
  function loadLocalUiSettings() {
    settings.brightness = parseFloat(localStorage.getItem(BRIGHTNESS_KEY)) || 1;
    settings.mode = localStorage.getItem(MODE_KEY) || "light";
  }

  function applySettings() {
    bgLayer.style.filter = "blur(" + settings.blur + "px) brightness(" + settings.brightness + ")";
    bgLayer.style.opacity = settings.transparency;
    if (settings.background_image) {
      bgLayer.style.backgroundImage =
        "url(/uploads/" + settings.background_image + ")";
    } else {
      bgLayer.style.backgroundImage = "";
    }
    document.body.dataset.theme = settings.theme || "cyan";
    document.body.dataset.mode = settings.mode || "light";
    themeSelect.value = settings.theme || "cyan";
    modeSelect.value = settings.mode || "light";
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
    loadLocalUiSettings();
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
    loadLocalUiSettings();
    document.body.dataset.theme = theme;
    updateSideRaysTheme(theme);
    updateSplashCursorTheme(theme);
    updateClickSparkTheme();
  }

  function saveMode() {
    settings.mode = modeSelect.value === "dark" ? "dark" : "light";
    localStorage.setItem(MODE_KEY, settings.mode);
    applySettings();
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

  // wiki-link navigation (delegated — preview is re-rendered)
  notePreview.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a.note-link") : null;
    if (!a) return;
    e.preventDefault();
    var noteId = a.getAttribute("data-note");
    if (noteId) { selectNote(noteId, true); return; }
    var title = a.getAttribute("data-title");
    if (title) {
      var n = findNoteByTitle(title);
      if (n) selectNote(n.id, true);
      else showToast("未找到笔记「" + title + "」", "error");
    }
  });

  // ── knowledge graph ──────────────────────────────────────────
  var graphOverlayEl = document.getElementById("graphOverlay");
  var graphCanvasEl = document.getElementById("graphCanvas");
  var graphCtx = graphCanvasEl.getContext("2d");
  var graphRaf = null;
  var graphData = null;      // { nodes:[...], links:[...] }
  var graphForce = { rep: 8000, link: 0.005, linkLen: 300, center: 0.0025, damp: 0.76 };
  var graphCam = { az: 0.5, el: 0.25, zoom: 1 };
  var graphPointer = null;
  var graphHover = null;
  var graphDrag = null;
  var graphThemeColor = "#22d3ee";

  function parseWikiLinks(text) {
    var refs = [];
    var re = /\[\[([^\]]+)\]\]/g;
    var m;
    while ((m = re.exec(text))) {
      var link = parseWikiLink(m[1]);
      if (link.title) refs.push(link);
    }
    return refs;
  }

  function computeGraph() {
    var nodes = notes.map(function (n) {
      return { id: n.id, title: n.title || "未命名", degree: 0 };
    });
    var nodeById = {};
    nodes.forEach(function (nd) { nodeById[nd.id] = nd; });
    var seen = {};
    var links = [];
    notes.forEach(function (n) {
      parseWikiLinks(n.content || "").forEach(function (ref) {
        var target = findNoteByTitle(ref.title);
        if (!target || target.id === n.id) return; // skip unresolved & self-links
        var key = n.id + ">" + target.id;
        if (seen[key]) return;
        seen[key] = true;
        links.push({ source: n.id, target: target.id });
        nodeById[n.id].degree++;
        nodeById[target.id].degree++;
      });
    });
    return { nodes: nodes, links: links };
  }

  function graphNodeRadius(n) {
    return 5 + Math.min(9, Math.sqrt(n.degree) * 3);
  }

  function simulateStep(jitter) {
    var nodes = graphData.nodes;
    var i, j;
    for (i = 0; i < nodes.length; i++) { nodes[i].fx = 0; nodes[i].fy = 0; nodes[i].fz = 0; }
    // repulsion (O(n²))
    for (i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      for (j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
        var d2 = dx * dx + dy * dy + dz * dz + 0.01;
        var d = Math.sqrt(d2);
        var f = graphForce.rep / d2;
        var ux = dx / d, uy = dy / d, uz = dz / d;
        a.fx += ux * f; a.fy += uy * f; a.fz += uz * f;
        b.fx -= ux * f; b.fy -= uy * f; b.fz -= uz * f;
      }
    }
    // link springs
    for (i = 0; i < graphData.links.length; i++) {
      var l = graphData.links[i];
      var a2 = l.s, b2 = l.t;
      var dx2 = b2.x - a2.x, dy2 = b2.y - a2.y, dz2 = b2.z - a2.z;
      var d3 = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2 + 0.01);
      var f2 = (d3 - graphForce.linkLen) * graphForce.link;
      var ux2 = dx2 / d3, uy2 = dy2 / d3, uz2 = dz2 / d3;
      a2.fx += ux2 * f2; a2.fy += uy2 * f2; a2.fz += uz2 * f2;
      b2.fx -= ux2 * f2; b2.fy -= uy2 * f2; b2.fz -= uz2 * f2;
    }
    // keep centered
    for (i = 0; i < nodes.length; i++) {
      var c = nodes[i];
      c.fx -= c.x * graphForce.center;
      c.fy -= c.y * graphForce.center;
      c.fz -= c.z * graphForce.center;
      // mild Z-flatten: keep nodes roughly coplanar so perspective depth
      // doesn't make distinct nodes visually overlap on screen
      c.fz -= c.z * 0.02;
    }
    // integrate
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (jitter) {
        n.vx += (Math.random() - 0.5) * 0.015;
        n.vy += (Math.random() - 0.5) * 0.015;
        n.vz += (Math.random() - 0.5) * 0.015;
      }
      n.vx = (n.vx + n.fx) * graphForce.damp;
      n.vy = (n.vy + n.fy) * graphForce.damp;
      n.vz = (n.vz + n.fz) * graphForce.damp;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    }
  }

  // project 3D nodes → 2D with perspective (camera orbits via az/el)
  function projectAll() {
    var W = graphCanvasEl.clientWidth, H = graphCanvasEl.clientHeight;
    var k = 0.5 * Math.min(W, H) || 1;
    var camDist = k * 1.7;
    var cosA = Math.cos(graphCam.az), sinA = Math.sin(graphCam.az);
    var cosE = Math.cos(graphCam.el), sinE = Math.sin(graphCam.el);
    var cx = W / 2, cy = H / 2;
    var out = [];
    for (var i = 0; i < graphData.nodes.length; i++) {
      var n = graphData.nodes[i];
      var x1 = n.x * cosA - n.z * sinA;
      var z1 = n.x * sinA + n.z * cosA;
      var y1 = n.y * cosE - z1 * sinE;
      var z2 = n.y * sinE + z1 * cosE;
      var depth = camDist + z2;
      var s = graphCam.zoom * k / depth;
      out.push({ n: n, x: cx + x1 * s, y: cy - y1 * s, s: s, depth: depth });
    }
    out.sort(function (a, b) { return b.depth - a.depth; }); // far first
    return out;
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex).replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function isGraphNeighbor(idA, idB) {
    if (idA === idB) return true;
    for (var i = 0; i < graphData.links.length; i++) {
      var l = graphData.links[i];
      if ((l.s.id === idA && l.t.id === idB) || (l.s.id === idB && l.t.id === idA)) return true;
    }
    return false;
  }

  function pickGraphNode(px, py) {
    var proj = projectAll();
    var best = null, bestD = 1e9;
    for (var i = 0; i < proj.length; i++) {
      var p = proj[i];
      var r = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
      var th = Math.max(16, r + 5);
      var d = Math.hypot(p.x - px, p.y - py);
      if (d < th && d < bestD) { bestD = d; best = p.n; }
    }
    return best;
  }

  function drawGraph() {
    var ctx = graphCtx;
    var W = graphCanvasEl.clientWidth, H = graphCanvasEl.clientHeight;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    var camDist = (0.5 * Math.min(W, H)) * 1.7;
    var proj = projectAll();
    var projById = {};
    for (var i = 0; i < proj.length; i++) projById[proj[i].n.id] = proj[i];

    // hover pick
    var hover = null;
    if (graphPointer && !(graphDrag && graphDrag.on)) {
      var best = null, bestD = 1e9;
      for (var i = 0; i < proj.length; i++) {
        var p = proj[i];
        var rr = graphNodeRadius(p.n) * Math.max(p.s, 0.3);
        var th = Math.max(16, rr + 5);
        var dd = Math.hypot(p.x - graphPointer.x, p.y - graphPointer.y);
        if (dd < th && dd < bestD) { bestD = dd; best = p.n; }
      }
      hover = best;
    }
    graphHover = hover;
    var hoverId = hover ? hover.id : null;

    // links
    ctx.lineWidth = 1.5;
    for (var i = 0; i < graphData.links.length; i++) {
      var l = graphData.links[i];
      var ps = projById[l.s.id], pt = projById[l.t.id];
      if (!ps || !pt) continue;
      var alpha = Math.max(0.12, Math.min(0.8, 1.1 - (ps.depth + pt.depth) / (2 * camDist)));
      if (hoverId && !isGraphNeighbor(hoverId, l.s.id)) alpha *= 0.08;
      ctx.strokeStyle = hexToRgba(graphThemeColor, alpha);
      ctx.beginPath();
      ctx.moveTo(ps.x, ps.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }

    // nodes + always-visible labels (far first)
    for (var i = 0; i < proj.length; i++) {
      var p = proj[i];
      var n = p.n;
      var r = graphNodeRadius(n) * Math.max(p.s, 0.3);
      var alpha = Math.max(0.25, Math.min(1, 1.15 - p.depth / (camDist * 1.4)));
      var dim = (hoverId && !isGraphNeighbor(hoverId, n.id)) ? 0.12 : 1;

      ctx.globalAlpha = alpha * dim;
      ctx.fillStyle = n.degree > 0 ? hexToRgba(graphThemeColor, 1) : "rgba(161,161,170,1)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255," + (0.7 * alpha * dim) + ")";
      ctx.lineWidth = 1;
      ctx.stroke();

      // label — always shown, highlighted (bright bold white + glow)
      var fs = Math.max(10, Math.min(14, 13 * p.s));
      ctx.font = "700 " + fs + "px system-ui, 'Segoe UI', sans-serif";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = "rgba(255,255,255," + Math.max(0.78, 0.95 * alpha * dim) + ")";
      ctx.fillText(n.title, p.x + r + 5, p.y + fs * 0.35);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function resizeGraphCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(graphCanvasEl.clientWidth * dpr));
    var h = Math.max(1, Math.round(graphCanvasEl.clientHeight * dpr));
    graphCanvasEl.width = w;
    graphCanvasEl.height = h;
    graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function graphRenderLoop() {
    if (graphOverlayEl.hidden) return;
    simulateStep(true);
    drawGraph();
    graphRaf = requestAnimationFrame(graphRenderLoop);
  }

  function openGraph() {
    var g = computeGraph();
    var showIsolated = document.getElementById("graphShowIsolated").checked;
    var nodes = showIsolated ? g.nodes : g.nodes.filter(function (n) { return n.degree > 0; });
    var nodeMap = {};
    nodes.forEach(function (n) { nodeMap[n.id] = n; });
    var links = [];
    g.links.forEach(function (l) {
      var s = nodeMap[l.source], t = nodeMap[l.target];
      if (s && t) links.push({ s: s, t: t });
    });
    nodes.forEach(function (n) {
      n.x = (Math.random() - 0.5) * 800;
      n.y = (Math.random() - 0.5) * 800;
      n.z = (Math.random() - 0.5) * 320;
      n.vx = 0; n.vy = 0; n.vz = 0; n.fx = 0; n.fy = 0; n.fz = 0;
    });
    graphData = { nodes: nodes, links: links };
    for (var i = 0; i < 500; i++) simulateStep(false); // pre-settle

    graphThemeColor = getComputedStyle(document.body)
      .getPropertyValue("--t-400").trim() || "#22d3ee";
    graphCam.az = 0.5; graphCam.el = 0.25; graphCam.zoom = 1;

    document.getElementById("graphStats").textContent =
      nodes.length + " 篇笔记 · " + links.length + " 条关联";

    graphOverlayEl.hidden = false;
    resizeGraphCanvas();
    if (graphRaf) cancelAnimationFrame(graphRaf);
    graphRaf = requestAnimationFrame(graphRenderLoop);
  }

  function closeGraph() {
    graphOverlayEl.hidden = true;
    if (graphRaf) { cancelAnimationFrame(graphRaf); graphRaf = null; }
    graphData = null;
    graphHover = null;
    graphPointer = null;
  }

  graphCanvasEl.addEventListener("mousemove", function (e) {
    var rect = graphCanvasEl.getBoundingClientRect();
    graphPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (graphDrag && graphDrag.on) {
      var dx = e.clientX - graphDrag.sx, dy = e.clientY - graphDrag.sy;
      graphCam.az += dx * 0.008;
      graphCam.el = Math.max(-1.25, Math.min(1.25, graphCam.el + dy * 0.008));
      graphDrag.sx = e.clientX;
      graphDrag.sy = e.clientY;
      graphDrag.moved += Math.abs(dx) + Math.abs(dy);
    }
  });
  graphCanvasEl.addEventListener("mouseleave", function () { graphPointer = null; });
  graphCanvasEl.addEventListener("mousedown", function (e) {
    graphDrag = { on: true, sx: e.clientX, sy: e.clientY, moved: 0 };
  });
  document.addEventListener("mouseup", function () { graphDrag = null; });
  graphCanvasEl.addEventListener("mouseup", function (e) {
    var wasClick = graphDrag && graphDrag.moved < 5;
    graphDrag = null;
    if (wasClick) {
      var rect = graphCanvasEl.getBoundingClientRect();
      var picked = pickGraphNode(e.clientX - rect.left, e.clientY - rect.top);
      if (picked) { selectNote(picked.id, true); closeGraph(); }
    }
  });
  graphCanvasEl.addEventListener("wheel", function (e) {
    e.preventDefault();
    graphCam.zoom = Math.max(0.4, Math.min(3.5, graphCam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
  }, { passive: false });

  document.getElementById("btnToggleGraph").addEventListener("click", openGraph);
  graphOverlayEl.addEventListener("click", function (e) {
    if (e.target === graphOverlayEl) closeGraph();
  });
  document.getElementById("graphClose").addEventListener("click", closeGraph);
  document.getElementById("graphShowIsolated").addEventListener("change", function () {
    if (!graphOverlayEl.hidden) openGraph();
  });
  window.addEventListener("resize", function () {
    if (!graphOverlayEl.hidden) resizeGraphCanvas();
  });

  noteTitle.addEventListener("input", function () {
    scheduleSave();
    noteTitle.classList.toggle("has-content", noteTitle.value.length > 0);
  });
  noteContent.addEventListener("input", scheduleSave);

  // ── [[ wiki-link autocomplete ─────────────────────────────────
  var suggestBox = document.createElement("div");
  suggestBox.className = "link-suggest";
  suggestBox.hidden = true;
  document.body.appendChild(suggestBox);

  var suggestItems = [];
  var suggestActive = -1;
  var suggestMatch = null;

  function insideFencedCode() {
    var before = noteContent.value.slice(0, noteContent.selectionStart);
    var fences = before.split("```").length - 1;
    return fences % 2 === 1;
  }

  // unclosed [[query right before the caret
  function currentLinkPrefix() {
    var val = noteContent.value;
    var pos = noteContent.selectionStart;
    if (typeof pos !== "number") return null;
    var m = /\[\[([^\[\]\n]*)$/.exec(val.slice(0, pos));
    if (!m || insideFencedCode()) return null;
    return { start: m.index, query: m[1] };
  }

  function suggestCandidates(query) {
    var q = normTitle(query);
    var list = notes.slice().sort(function (a, b) {
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
    if (!q) return list.slice(0, 8);
    var lower = query.toLowerCase();
    return list.filter(function (n) {
      var t = n.title || "未命名";
      return normTitle(t).indexOf(q) !== -1 || t.toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 8);
  }

  function openSuggest() {
    var m = currentLinkPrefix();
    if (!m) { closeSuggest(); return; }
    var items = suggestCandidates(m.query);
    if (items.length === 0) { closeSuggest(); return; }
    suggestMatch = m;
    suggestItems = items;
    suggestActive = 0;
    renderSuggestBox();
    positionSuggestBox();
    suggestBox.hidden = false;
  }

  function closeSuggest() {
    suggestBox.hidden = true;
    suggestBox.innerHTML = "";
    suggestMatch = null;
    suggestItems = [];
    suggestActive = -1;
  }

  function renderSuggestBox() {
    suggestBox.innerHTML = "";
    suggestItems.forEach(function (n, i) {
      var item = document.createElement("div");
      item.className = "link-suggest-item" + (i === suggestActive ? " active" : "");
      item.textContent = n.title || "未命名";
      item.addEventListener("mousedown", function (e) {
        e.preventDefault(); // keep focus in the textarea
        insertSuggestion(n);
      });
      suggestBox.appendChild(item);
    });
    var activeEl = suggestBox.children[suggestActive];
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
  }

  // caret pixel position via a hidden "mirror" of the textarea
  function caretCoordinates() {
    var ta = noteContent;
    var cs = getComputedStyle(ta);
    var div = document.createElement("div");
    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordWrap = "break-word";
    [
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
      "lineHeight", "paddingLeft", "paddingRight", "paddingTop", "paddingBottom",
      "borderLeftWidth", "borderRightWidth", "borderTopWidth", "borderBottomWidth",
      "textIndent",
    ].forEach(function (p) { div.style[p] = cs[p]; });
    div.style.width = ta.clientWidth + "px";
    div.textContent = ta.value.substring(0, ta.selectionStart);
    var span = document.createElement("span");
    span.textContent = div.textContent.length ? "​" : ".";
    div.appendChild(span);
    document.body.appendChild(div);
    var coords = {
      top: span.offsetTop - ta.scrollTop,
      left: span.offsetLeft - ta.scrollLeft,
    };
    document.body.removeChild(div);
    return coords;
  }

  function positionSuggestBox() {
    var coords = caretCoordinates();
    var rect = noteContent.getBoundingClientRect();
    var fontSize = parseFloat(getComputedStyle(noteContent).fontSize) || 14;
    var x = rect.left + coords.left;
    var y = rect.top + coords.top + fontSize * 1.4;
    if (x + 200 > window.innerWidth) x = window.innerWidth - 220;
    suggestBox.style.left = Math.max(8, x) + "px";
    suggestBox.style.top = Math.max(8, y) + "px";
  }

  function insertSuggestion(n) {
    var m = suggestMatch || currentLinkPrefix();
    if (!m) return;
    var val = noteContent.value;
    var pos = noteContent.selectionStart;
    var title = n.title || "未命名";
    noteContent.value = val.slice(0, m.start) + "[[" + title + "]]" + val.slice(pos);
    var caret = m.start + 2 + title.length + 2;
    noteContent.setSelectionRange(caret, caret);
    closeSuggest();
    noteContent.focus();
    noteContent.dispatchEvent(new Event("input")); // triggers autosave
  }

  noteContent.addEventListener("input", openSuggest);
  noteContent.addEventListener("keydown", function (e) {
    if (suggestBox.hidden) return;
    var key = e.key;
    if (key === "ArrowDown") {
      e.preventDefault();
      suggestActive = (suggestActive + 1) % suggestItems.length;
      renderSuggestBox();
    } else if (key === "ArrowUp") {
      e.preventDefault();
      suggestActive = (suggestActive - 1 + suggestItems.length) % suggestItems.length;
      renderSuggestBox();
    } else if (key === "Enter" || key === "Tab") {
      e.preventDefault();
      if (suggestItems[suggestActive]) insertSuggestion(suggestItems[suggestActive]);
    } else if (key === "Escape") {
      e.preventDefault();
      closeSuggest();
    }
  });
  noteContent.addEventListener("blur", function () {
    setTimeout(closeSuggest, 120); // let item mousedown fire first
  });
  noteContent.addEventListener("scroll", closeSuggest);

  blurSlider.addEventListener("input", function () {
    blurVal.textContent = blurSlider.value + "px";
  });
  transSlider.addEventListener("input", function () {
    transVal.textContent = parseFloat(transSlider.value).toFixed(2);
  });
  blurSlider.addEventListener("change", updateSettings);
  transSlider.addEventListener("change", updateSettings);

  brightnessSlider.addEventListener("input", function () {
    var v = parseFloat(brightnessSlider.value) || 1;
    brightnessVal.textContent = v.toFixed(2);
    settings.brightness = v;
    applySettings(); // live preview while dragging
  });
  brightnessSlider.addEventListener("change", function () {
    localStorage.setItem(BRIGHTNESS_KEY, String(settings.brightness));
  });

  modeSelect.addEventListener("change", saveMode);

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
    // Escape closes settings drawer / graph overlay
    if (e.key === "Escape") {
      if (settingsPanel.classList.contains("open")) closeSettings();
      if (!graphOverlayEl.hidden) closeGraph();
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
