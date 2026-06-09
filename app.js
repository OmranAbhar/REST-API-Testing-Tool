(function () {
  "use strict";

  const DB_STORAGE_KEY = "postmans.sqlite.base64.v1";
  const EXPORT_VERSION = 1;

  const els = {
    dbStatus: document.getElementById("dbStatus"),
    projectSelect: document.getElementById("projectSelect"),
    folderSelect: document.getElementById("folderSelect"),
    addProjectBtn: document.getElementById("addProjectBtn"),
    addFolderBtn: document.getElementById("addFolderBtn"),
    searchInput: document.getElementById("searchInput"),
    savedRequestsList: document.getElementById("savedRequestsList"),
    historyList: document.getElementById("historyList"),
    requestCount: document.getElementById("requestCount"),
    historyCount: document.getElementById("historyCount"),
    methodSelect: document.getElementById("methodSelect"),
    urlInput: document.getElementById("urlInput"),
    sendBtn: document.getElementById("sendBtn"),
    sendSpinner: document.getElementById("sendSpinner"),
    newRequestBtn: document.getElementById("newRequestBtn"),
    sampleBtn: document.getElementById("sampleBtn"),
    exportBtn: document.getElementById("exportBtn"),
    importInput: document.getElementById("importInput"),
    saveRequestBtn: document.getElementById("saveRequestBtn"),
    deleteRequestBtn: document.getElementById("deleteRequestBtn"),
    duplicateBtn: document.getElementById("duplicateBtn"),
    favoriteBtn: document.getElementById("favoriteBtn"),
    requestNameInput: document.getElementById("requestNameInput"),
    descriptionInput: document.getElementById("descriptionInput"),
    notesInput: document.getElementById("notesInput"),
    paramsList: document.getElementById("paramsList"),
    headersList: document.getElementById("headersList"),
    formRowsList: document.getElementById("formRowsList"),
    addParamBtn: document.getElementById("addParamBtn"),
    addHeaderBtn: document.getElementById("addHeaderBtn"),
    addFormRowBtn: document.getElementById("addFormRowBtn"),
    rawBodyEditor: document.getElementById("rawBodyEditor"),
    formDataEditor: document.getElementById("formDataEditor"),
    rawBodyInput: document.getElementById("rawBodyInput"),
    rawBodyLabel: document.getElementById("rawBodyLabel"),
    formatJsonBtn: document.getElementById("formatJsonBtn"),
    responseBody: document.getElementById("responseBody"),
    responseHeaders: document.getElementById("responseHeaders"),
    responseMeta: document.getElementById("responseMeta"),
    rowTemplate: document.getElementById("keyValueRowTemplate")
  };

  const state = {
    SQL: null,
    db: null,
    currentRequestId: null,
    lastSavedFavorite: false
  };

  const methodsWithoutBody = new Set(["GET"]);

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    bindEvents();
    initRows();
    setControlsEnabled(false);
    await initDatabase();
    ensureDefaultData();
    renderAll();
    newRequest();
    setControlsEnabled(true);
  }

  async function initDatabase() {
    try {
      els.dbStatus.textContent = "SQLite loading";
      state.SQL = await initSqlJs({
        locateFile: function (file) {
          return "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/" + file;
        }
      });

      const saved = localStorage.getItem(DB_STORAGE_KEY);
      state.db = saved ? new state.SQL.Database(base64ToBytes(saved)) : new state.SQL.Database();
      createSchema();
      els.dbStatus.textContent = "SQLite ready";
    } catch (error) {
      els.dbStatus.textContent = "SQLite unavailable";
      renderError("SQLite could not start: " + error.message);
      throw error;
    }
  }

  function createSchema() {
    execSql(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        parent_id INTEGER,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS api_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        folder_id INTEGER,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        body_type TEXT NOT NULL DEFAULT 'none',
        body_content TEXT DEFAULT '',
        is_favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS request_headers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        header_key TEXT NOT NULL,
        header_value TEXT DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (request_id) REFERENCES api_requests(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS request_parameters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER NOT NULL,
        param_key TEXT NOT NULL,
        param_value TEXT DEFAULT '',
        location TEXT NOT NULL DEFAULT 'query',
        sort_order INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (request_id) REFERENCES api_requests(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS request_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id INTEGER,
        project_id INTEGER,
        folder_id INTEGER,
        name TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        request_snapshot TEXT NOT NULL,
        status_code INTEGER,
        status_text TEXT,
        response_time_ms INTEGER,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES api_requests(id) ON DELETE SET NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
      );
    `);
  }

  function ensureDefaultData() {
    if (queryOne("SELECT COUNT(*) AS count FROM projects").count === 0) {
      const now = timestamp();
      runSql("INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)", [
        "Default Project",
        "Personal API workspace",
        now,
        now
      ]);
      const projectId = getLastInsertId();
      runSql("INSERT INTO folders (project_id, parent_id, name, description, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)", [
        projectId,
        "General",
        "Default request folder",
        now,
        now
      ]);
      persistDb();
    }
  }

  function bindEvents() {
    els.addProjectBtn.addEventListener("click", addProject);
    els.addFolderBtn.addEventListener("click", addFolder);
    els.projectSelect.addEventListener("change", function () {
      renderFolders();
      renderSavedRequests();
      state.currentRequestId = null;
    });
    els.folderSelect.addEventListener("change", renderSavedRequests);
    els.searchInput.addEventListener("input", renderSavedRequests);
    els.addParamBtn.addEventListener("click", function () { addKeyValueRow(els.paramsList); });
    els.addHeaderBtn.addEventListener("click", function () { addKeyValueRow(els.headersList); });
    els.addFormRowBtn.addEventListener("click", function () { addKeyValueRow(els.formRowsList); });
    els.sendBtn.addEventListener("click", sendRequest);
    els.saveRequestBtn.addEventListener("click", saveCurrentRequest);
    els.newRequestBtn.addEventListener("click", newRequest);
    els.sampleBtn.addEventListener("click", loadSample);
    els.deleteRequestBtn.addEventListener("click", deleteCurrentRequest);
    els.duplicateBtn.addEventListener("click", duplicateCurrentRequest);
    els.favoriteBtn.addEventListener("click", toggleFavorite);
    els.exportBtn.addEventListener("click", exportProjects);
    els.importInput.addEventListener("change", importProjects);
    els.formatJsonBtn.addEventListener("click", formatJsonBody);
    els.urlInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") sendRequest();
    });

    document.querySelectorAll('input[name="bodyType"]').forEach(function (radio) {
      radio.addEventListener("change", updateBodyEditors);
    });
  }

  function initRows() {
    addKeyValueRow(els.paramsList);
    addKeyValueRow(els.headersList);
    addKeyValueRow(els.formRowsList);
    updateBodyEditors();
  }

  function setControlsEnabled(enabled) {
    document.querySelectorAll("button, input, textarea, select").forEach(function (control) {
      if (control.id !== "importInput") control.disabled = !enabled;
    });
  }

  function renderAll() {
    renderProjects();
    renderFolders();
    renderSavedRequests();
    renderHistory();
  }

  function renderProjects() {
    const selected = Number(els.projectSelect.value);
    const projects = queryAll("SELECT * FROM projects ORDER BY name COLLATE NOCASE");
    els.projectSelect.innerHTML = "";
    projects.forEach(function (project) {
      const option = new Option(project.name, project.id);
      els.projectSelect.appendChild(option);
    });
    if (projects.some(function (project) { return project.id === selected; })) {
      els.projectSelect.value = String(selected);
    }
  }

  function renderFolders() {
    const projectId = getProjectId();
    const folders = queryAll("SELECT * FROM folders WHERE project_id = ? ORDER BY parent_id, name COLLATE NOCASE", [projectId]);
    const selected = Number(els.folderSelect.value);
    els.folderSelect.innerHTML = "";
    els.folderSelect.appendChild(new Option("No folder", ""));
    buildFolderOptions(folders, null, 0).forEach(function (option) {
      els.folderSelect.appendChild(option);
    });
    if (folders.some(function (folder) { return folder.id === selected; })) {
      els.folderSelect.value = String(selected);
    }
  }

  function buildFolderOptions(folders, parentId, depth) {
    return folders
      .filter(function (folder) { return nullableNumber(folder.parent_id) === nullableNumber(parentId); })
      .flatMap(function (folder) {
        const option = new Option("  ".repeat(depth) + folder.name, folder.id);
        return [option].concat(buildFolderOptions(folders, folder.id, depth + 1));
      });
  }

  function renderSavedRequests() {
    const projectId = getProjectId();
    const folderId = getFolderId();
    const search = els.searchInput.value.trim().toLowerCase();
    let sql = "SELECT * FROM api_requests WHERE project_id = ?";
    const params = [projectId];

    if (folderId) {
      sql += " AND folder_id = ?";
      params.push(folderId);
    }

    sql += " ORDER BY is_favorite DESC, updated_at DESC";
    const requests = queryAll(sql, params).filter(function (request) {
      if (!search) return true;
      return [request.name, request.method, request.url, request.description, request.notes]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    els.savedRequestsList.innerHTML = "";
    els.requestCount.textContent = String(requests.length);

    if (!requests.length) {
      els.savedRequestsList.innerHTML = '<div class="empty-state">No saved APIs match this view.</div>';
      return;
    }

    requests.forEach(function (request) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "saved-item" + (request.id === state.currentRequestId ? " active" : "");
      item.innerHTML = `
        <span class="saved-main">
          <span class="method-badge">${escapeHtml(request.method)}</span>
          <span class="saved-name">${escapeHtml(request.name)}</span>
          ${request.is_favorite ? '<span class="favorite-mark">Favorite</span>' : ""}
        </span>
        <span class="saved-url">${escapeHtml(request.url)}</span>
      `;
      item.addEventListener("click", function () {
        loadRequest(request.id);
      });
      els.savedRequestsList.appendChild(item);
    });
  }

  function renderHistory() {
    const rows = queryAll("SELECT * FROM request_history ORDER BY created_at DESC LIMIT 30");
    els.historyList.innerHTML = "";
    els.historyCount.textContent = String(rows.length);

    if (!rows.length) {
      els.historyList.innerHTML = '<div class="empty-state">No request history yet.</div>';
      return;
    }

    rows.forEach(function (entry) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "history-item";
      const status = entry.error_message ? "Error" : (entry.status_code || "No status");
      item.innerHTML = `
        <span><strong>${escapeHtml(entry.method)}</strong> ${escapeHtml(entry.name)}</span>
        <span>${escapeHtml(String(status))} · ${escapeHtml(String(entry.response_time_ms || 0))} ms</span>
      `;
      item.addEventListener("click", function () {
        const snapshot = JSON.parse(entry.request_snapshot);
        applyConfig(snapshot);
        state.currentRequestId = entry.request_id || null;
        updateFavoriteButton(snapshot.is_favorite);
        renderSavedRequests();
      });
      els.historyList.appendChild(item);
    });
  }

  function addProject() {
    const name = prompt("Project name");
    if (!name || !name.trim()) return;
    const now = timestamp();
    runSql("INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, '', ?, ?)", [name.trim(), now, now]);
    persistDb();
    renderProjects();
    els.projectSelect.value = String(getLastInsertId());
    renderFolders();
    renderSavedRequests();
  }

  function addFolder() {
    const projectId = getProjectId();
    const parentId = getFolderId();
    const name = prompt("Folder name");
    if (!name || !name.trim()) return;
    const now = timestamp();
    runSql("INSERT INTO folders (project_id, parent_id, name, description, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?)", [
      projectId,
      parentId,
      name.trim(),
      now,
      now
    ]);
    persistDb();
    renderFolders();
    els.folderSelect.value = String(getLastInsertId());
    renderSavedRequests();
  }

  function newRequest() {
    state.currentRequestId = null;
    els.requestNameInput.value = "";
    els.descriptionInput.value = "";
    els.notesInput.value = "";
    els.methodSelect.value = "GET";
    els.urlInput.value = "";
    clearRows();
    setSelectedBodyType("none");
    els.rawBodyInput.value = "";
    updateFavoriteButton(false);
    renderMeta([{ label: "Idle", tone: "neutral" }]);
    els.responseBody.textContent = "Send a request to see the response here.";
    els.responseHeaders.textContent = "Response headers will appear here.";
    renderSavedRequests();
  }

  function loadSample() {
    newRequest();
    els.requestNameInput.value = "Create echo payload";
    els.descriptionInput.value = "Sample POST request for testing JSON payloads.";
    els.notesInput.value = "Uses httpbin and stores the full request configuration in SQLite when saved.";
    els.methodSelect.value = "POST";
    els.urlInput.value = "https://httpbin.org/post";
    els.headersList.innerHTML = "";
    els.paramsList.innerHTML = "";
    addKeyValueRow(els.headersList, "Accept", "application/json");
    addKeyValueRow(els.paramsList, "source", "postmans");
    setSelectedBodyType("json");
    els.rawBodyInput.value = JSON.stringify({
      name: "Postmans",
      purpose: "API testing",
      active: true
    }, null, 2);
  }

  function saveCurrentRequest() {
    try {
      const config = collectConfig();
      const now = timestamp();

      if (state.currentRequestId) {
        runSql(`
          UPDATE api_requests
          SET project_id = ?, folder_id = ?, name = ?, description = ?, notes = ?, method = ?, url = ?,
              body_type = ?, body_content = ?, is_favorite = ?, updated_at = ?
          WHERE id = ?
        `, [
          config.project_id,
          config.folder_id,
          config.name,
          config.description,
          config.notes,
          config.method,
          config.url,
          config.body_type,
          config.body_content,
          config.is_favorite ? 1 : 0,
          now,
          state.currentRequestId
        ]);
      } else {
        runSql(`
          INSERT INTO api_requests
            (project_id, folder_id, name, description, notes, method, url, body_type, body_content, is_favorite, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          config.project_id,
          config.folder_id,
          config.name,
          config.description,
          config.notes,
          config.method,
          config.url,
          config.body_type,
          config.body_content,
          config.is_favorite ? 1 : 0,
          now,
          now
        ]);
        state.currentRequestId = getLastInsertId();
      }

      replaceConfigRows(state.currentRequestId, config);
      persistDb();
      renderSavedRequests();
      renderMeta([{ label: "Saved", tone: "success" }]);
    } catch (error) {
      renderError(error.message);
    }
  }

  function replaceConfigRows(requestId, config) {
    runSql("DELETE FROM request_headers WHERE request_id = ?", [requestId]);
    runSql("DELETE FROM request_parameters WHERE request_id = ?", [requestId]);

    config.headers.forEach(function (header, index) {
      runSql("INSERT INTO request_headers (request_id, header_key, header_value, sort_order) VALUES (?, ?, ?, ?)", [
        requestId,
        header.key,
        header.value,
        index
      ]);
    });

    config.query_params.forEach(function (param, index) {
      runSql("INSERT INTO request_parameters (request_id, param_key, param_value, location, sort_order) VALUES (?, ?, ?, 'query', ?)", [
        requestId,
        param.key,
        param.value,
        index
      ]);
    });

    config.form_fields.forEach(function (field, index) {
      runSql("INSERT INTO request_parameters (request_id, param_key, param_value, location, sort_order) VALUES (?, ?, ?, 'form', ?)", [
        requestId,
        field.key,
        field.value,
        index
      ]);
    });
  }

  function loadRequest(requestId) {
    const request = queryOne("SELECT * FROM api_requests WHERE id = ?", [requestId]);
    if (!request) return;

    const config = hydrateConfig(request);
    applyConfig(config);
    state.currentRequestId = requestId;
    updateFavoriteButton(Boolean(request.is_favorite));
    renderSavedRequests();
  }

  function deleteCurrentRequest() {
    if (!state.currentRequestId) {
      renderError("Select a saved API before deleting.");
      return;
    }
    if (!confirm("Delete this saved API request?")) return;
    runSql("DELETE FROM api_requests WHERE id = ?", [state.currentRequestId]);
    persistDb();
    newRequest();
    renderAll();
  }

  function duplicateCurrentRequest() {
    try {
      const source = state.currentRequestId ? hydrateConfig(queryOne("SELECT * FROM api_requests WHERE id = ?", [state.currentRequestId])) : collectConfig();
      source.name = source.name + " Copy";
      source.is_favorite = false;
      applyConfig(source);
      state.currentRequestId = null;
      updateFavoriteButton(false);
      saveCurrentRequest();
    } catch (error) {
      renderError(error.message);
    }
  }

  function toggleFavorite() {
    const next = !state.lastSavedFavorite;
    updateFavoriteButton(next);
    if (state.currentRequestId) {
      runSql("UPDATE api_requests SET is_favorite = ?, updated_at = ? WHERE id = ?", [next ? 1 : 0, timestamp(), state.currentRequestId]);
      persistDb();
      renderSavedRequests();
    }
  }

  async function sendRequest() {
    setLoading(true);
    renderMeta([{ label: "Sending...", tone: "neutral" }]);
    els.responseBody.textContent = "Waiting for response...";
    els.responseHeaders.textContent = "Waiting for response headers...";

    const startedAt = performance.now();
    let config;

    try {
      config = collectConfig();
      const url = buildUrl(config.url, config.query_params);
      const options = buildRequestOptions(config);
      const response = await fetch(url, options);
      const elapsed = Math.round(performance.now() - startedAt);

      els.responseBody.textContent = await formatResponseBody(response);
      els.responseHeaders.textContent = formatHeaders(response.headers);
      renderMeta([
        { label: response.status + " " + response.statusText, tone: statusTone(response.status) },
        { label: elapsed + " ms", tone: "neutral" },
        { label: options.method, tone: "neutral" }
      ]);
      insertHistory(config, response.status, response.statusText, elapsed, "");
    } catch (error) {
      const elapsed = Math.round(performance.now() - startedAt);
      els.responseBody.textContent = "Error: " + error.message;
      els.responseHeaders.textContent = "No headers available.";
      renderMeta([
        { label: "Request failed", tone: "error" },
        { label: elapsed + " ms", tone: "neutral" }
      ]);
      if (config) insertHistory(config, null, "", elapsed, error.message);
    } finally {
      setLoading(false);
    }
  }

  function insertHistory(config, statusCode, statusText, elapsed, errorMessage) {
    runSql(`
      INSERT INTO request_history
        (request_id, project_id, folder_id, name, method, url, request_snapshot, status_code, status_text, response_time_ms, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      state.currentRequestId,
      config.project_id,
      config.folder_id,
      config.name,
      config.method,
      config.url,
      JSON.stringify(config),
      statusCode,
      statusText,
      elapsed,
      errorMessage,
      timestamp()
    ]);
    persistDb();
    renderHistory();
  }

  function collectConfig() {
    const name = els.requestNameInput.value.trim() || deriveRequestName();
    const bodyType = getSelectedBodyType();
    const rawBody = els.rawBodyInput.value;

    if (bodyType === "json" && rawBody.trim()) {
      JSON.parse(rawBody);
    }

    return {
      project_id: getProjectId(),
      folder_id: getFolderId(),
      name: name,
      description: els.descriptionInput.value.trim(),
      notes: els.notesInput.value.trim(),
      method: els.methodSelect.value,
      url: els.urlInput.value.trim(),
      body_type: bodyType,
      body_content: bodyType === "json" || bodyType === "text" ? rawBody : "",
      is_favorite: state.lastSavedFavorite,
      headers: getRows(els.headersList),
      query_params: getRows(els.paramsList),
      form_fields: getRows(els.formRowsList)
    };
  }

  function hydrateConfig(request) {
    return {
      project_id: request.project_id,
      folder_id: request.folder_id,
      name: request.name,
      description: request.description || "",
      notes: request.notes || "",
      method: request.method,
      url: request.url,
      body_type: request.body_type,
      body_content: request.body_content || "",
      is_favorite: Boolean(request.is_favorite),
      headers: queryAll("SELECT header_key AS key, header_value AS value FROM request_headers WHERE request_id = ? ORDER BY sort_order", [request.id]),
      query_params: queryAll("SELECT param_key AS key, param_value AS value FROM request_parameters WHERE request_id = ? AND location = 'query' ORDER BY sort_order", [request.id]),
      form_fields: queryAll("SELECT param_key AS key, param_value AS value FROM request_parameters WHERE request_id = ? AND location = 'form' ORDER BY sort_order", [request.id])
    };
  }

  function applyConfig(config) {
    els.projectSelect.value = String(config.project_id || getProjectId());
    renderFolders();
    els.folderSelect.value = config.folder_id ? String(config.folder_id) : "";
    els.requestNameInput.value = config.name || "";
    els.descriptionInput.value = config.description || "";
    els.notesInput.value = config.notes || "";
    els.methodSelect.value = config.method || "GET";
    els.urlInput.value = config.url || "";
    els.rawBodyInput.value = config.body_content || "";
    setSelectedBodyType(config.body_type || "none");
    fillRows(els.headersList, config.headers || []);
    fillRows(els.paramsList, config.query_params || []);
    fillRows(els.formRowsList, config.form_fields || []);
    updateFavoriteButton(Boolean(config.is_favorite));
  }

  function buildUrl(rawUrl, queryParams) {
    if (!rawUrl) throw new Error("Enter a request URL.");
    let url;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      throw new Error("Enter a valid absolute URL, including http:// or https://.");
    }
    queryParams.forEach(function (param) {
      url.searchParams.append(param.key, param.value);
    });
    return url.toString();
  }

  function buildRequestOptions(config) {
    const headers = new Headers();
    config.headers.forEach(function (header) {
      headers.append(header.key, header.value);
    });

    const options = { method: config.method, headers: headers };
    if (methodsWithoutBody.has(config.method) || config.body_type === "none") return options;

    if (config.body_type === "json") {
      options.body = config.body_content.trim() ? config.body_content : "";
      setHeaderIfMissing(headers, "Content-Type", "application/json");
    }

    if (config.body_type === "text") {
      options.body = config.body_content;
      setHeaderIfMissing(headers, "Content-Type", "text/plain;charset=UTF-8");
    }

    if (config.body_type === "form-data") {
      const formData = new FormData();
      config.form_fields.forEach(function (field) {
        formData.append(field.key, field.value);
      });
      options.body = formData;
      headers.delete("Content-Type");
    }

    if (config.body_type === "urlencoded") {
      const params = new URLSearchParams();
      config.form_fields.forEach(function (field) {
        params.append(field.key, field.value);
      });
      options.body = params.toString();
      setHeaderIfMissing(headers, "Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    }

    return options;
  }

  function exportProjects() {
    const payload = {
      app: "Postmans",
      version: EXPORT_VERSION,
      exported_at: timestamp(),
      projects: queryAll("SELECT * FROM projects ORDER BY id"),
      folders: queryAll("SELECT * FROM folders ORDER BY id"),
      api_requests: queryAll("SELECT * FROM api_requests ORDER BY id"),
      request_headers: queryAll("SELECT * FROM request_headers ORDER BY request_id, sort_order"),
      request_parameters: queryAll("SELECT * FROM request_parameters ORDER BY request_id, location, sort_order"),
      request_history: queryAll("SELECT * FROM request_history ORDER BY id")
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "postmans-projects-" + new Date().toISOString().slice(0, 10) + ".json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importProjects(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const payload = JSON.parse(String(reader.result));
        validateImport(payload);
        importPayload(payload);
        persistDb();
        renderAll();
        newRequest();
        renderMeta([{ label: "Imported", tone: "success" }]);
      } catch (error) {
        renderError("Import failed: " + error.message);
      } finally {
        els.importInput.value = "";
      }
    };
    reader.readAsText(file);
  }

  function validateImport(payload) {
    ["projects", "folders", "api_requests", "request_headers", "request_parameters"].forEach(function (key) {
      if (!Array.isArray(payload[key])) throw new Error("Missing " + key + " array.");
    });
  }

  function importPayload(payload) {
    const projectMap = new Map();
    const folderMap = new Map();
    const requestMap = new Map();
    const now = timestamp();

    payload.projects.forEach(function (project) {
      runSql("INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)", [
        uniqueName(project.name || "Imported Project", "projects"),
        project.description || "",
        project.created_at || now,
        now
      ]);
      projectMap.set(project.id, getLastInsertId());
    });

    payload.folders.forEach(function (folder) {
      runSql("INSERT INTO folders (project_id, parent_id, name, description, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)", [
        projectMap.get(folder.project_id),
        folder.name || "Imported Folder",
        folder.description || "",
        folder.created_at || now,
        now
      ]);
      folderMap.set(folder.id, getLastInsertId());
    });

    payload.folders.forEach(function (folder) {
      if (folder.parent_id && folderMap.has(folder.parent_id)) {
        runSql("UPDATE folders SET parent_id = ? WHERE id = ?", [folderMap.get(folder.parent_id), folderMap.get(folder.id)]);
      }
    });

    payload.api_requests.forEach(function (request) {
      runSql(`
        INSERT INTO api_requests
          (project_id, folder_id, name, description, notes, method, url, body_type, body_content, is_favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        projectMap.get(request.project_id),
        request.folder_id ? folderMap.get(request.folder_id) : null,
        request.name || "Imported Request",
        request.description || "",
        request.notes || "",
        request.method || "GET",
        request.url || "",
        request.body_type || "none",
        request.body_content || "",
        request.is_favorite ? 1 : 0,
        request.created_at || now,
        now
      ]);
      requestMap.set(request.id, getLastInsertId());
    });

    payload.request_headers.forEach(function (header) {
      if (!requestMap.has(header.request_id)) return;
      runSql("INSERT INTO request_headers (request_id, header_key, header_value, sort_order) VALUES (?, ?, ?, ?)", [
        requestMap.get(header.request_id),
        header.header_key,
        header.header_value || "",
        header.sort_order || 0
      ]);
    });

    payload.request_parameters.forEach(function (param) {
      if (!requestMap.has(param.request_id)) return;
      runSql("INSERT INTO request_parameters (request_id, param_key, param_value, location, sort_order) VALUES (?, ?, ?, ?, ?)", [
        requestMap.get(param.request_id),
        param.param_key,
        param.param_value || "",
        param.location || "query",
        param.sort_order || 0
      ]);
    });
  }

  function addKeyValueRow(container, key = "", value = "") {
    const fragment = els.rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".key-value-row");
    const keyInput = fragment.querySelector(".key-input");
    const valueInput = fragment.querySelector(".value-input");
    const removeBtn = fragment.querySelector(".remove-row-btn");

    keyInput.value = key;
    valueInput.value = value;
    removeBtn.addEventListener("click", function () {
      row.remove();
      ensureMinimumRow(container);
    });

    container.appendChild(fragment);
  }

  function fillRows(container, rows) {
    container.innerHTML = "";
    rows.forEach(function (row) {
      addKeyValueRow(container, row.key, row.value);
    });
    ensureMinimumRow(container);
  }

  function clearRows() {
    fillRows(els.paramsList, []);
    fillRows(els.headersList, []);
    fillRows(els.formRowsList, []);
  }

  function ensureMinimumRow(container) {
    if (!container.querySelector(".key-value-row")) addKeyValueRow(container);
  }

  function getRows(container) {
    return Array.from(container.querySelectorAll(".key-value-row"))
      .map(function (row) {
        return {
          key: row.querySelector(".key-input").value.trim(),
          value: row.querySelector(".value-input").value
        };
      })
      .filter(function (entry) {
        return entry.key.length > 0;
      });
  }

  function getSelectedBodyType() {
    return document.querySelector('input[name="bodyType"]:checked').value;
  }

  function setSelectedBodyType(type) {
    const radio = document.querySelector('input[name="bodyType"][value="' + type + '"]');
    if (radio) {
      radio.checked = true;
      updateBodyEditors();
    }
  }

  function updateBodyEditors() {
    const type = getSelectedBodyType();
    const isRaw = type === "json" || type === "text";
    const isForm = type === "form-data" || type === "urlencoded";
    els.rawBodyEditor.classList.toggle("d-none", !isRaw);
    els.formDataEditor.classList.toggle("d-none", !isForm);
    els.formatJsonBtn.classList.toggle("d-none", type !== "json");
    els.rawBodyLabel.textContent = type === "json" ? "JSON body" : "Text body";
  }

  function updateFavoriteButton(isFavorite) {
    state.lastSavedFavorite = Boolean(isFavorite);
    els.favoriteBtn.classList.toggle("btn-warning", state.lastSavedFavorite);
    els.favoriteBtn.classList.toggle("btn-outline-warning", !state.lastSavedFavorite);
    els.favoriteBtn.textContent = state.lastSavedFavorite ? "Favorited" : "Favorite";
  }

  function formatJsonBody() {
    try {
      els.rawBodyInput.value = JSON.stringify(JSON.parse(els.rawBodyInput.value), null, 2);
    } catch (error) {
      renderError("JSON format error: " + error.message);
    }
  }

  function setHeaderIfMissing(headers, key, value) {
    if (!headers.has(key)) headers.set(key, value);
  }

  function formatHeaders(headers) {
    const lines = [];
    headers.forEach(function (value, key) {
      lines.push(key + ": " + value);
    });
    return lines.length ? lines.join("\n") : "No response headers returned.";
  }

  async function formatResponseBody(response) {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (!text) return "No response body.";
    if (contentType.includes("application/json") || looksLikeJson(text)) {
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch (error) {
        return text;
      }
    }
    return text;
  }

  function looksLikeJson(text) {
    const trimmed = text.trim();
    return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"));
  }

  function setLoading(isLoading) {
    els.sendBtn.disabled = isLoading;
    els.sendSpinner.classList.toggle("d-none", !isLoading);
    els.sendBtn.querySelector(".send-label").textContent = isLoading ? "Sending" : "Send";
  }

  function renderMeta(items) {
    els.responseMeta.innerHTML = "";
    items.forEach(function (item) {
      const pill = document.createElement("span");
      pill.className = "meta-pill " + item.tone;
      pill.textContent = item.label;
      els.responseMeta.appendChild(pill);
    });
  }

  function renderError(message) {
    els.responseBody.textContent = "Error: " + message;
    renderMeta([{ label: "Error", tone: "error" }]);
  }

  function statusTone(status) {
    if (status >= 200 && status < 300) return "success";
    if (status >= 300 && status < 500) return "warning";
    return "error";
  }

  function deriveRequestName() {
    if (!els.urlInput.value.trim()) return "Untitled request";
    try {
      const url = new URL(els.urlInput.value.trim());
      return els.methodSelect.value + " " + (url.pathname === "/" ? url.hostname : url.pathname);
    } catch (error) {
      return els.methodSelect.value + " request";
    }
  }

  function getProjectId() {
    return Number(els.projectSelect.value) || queryOne("SELECT id FROM projects ORDER BY id LIMIT 1").id;
  }

  function getFolderId() {
    return els.folderSelect.value ? Number(els.folderSelect.value) : null;
  }

  function timestamp() {
    return new Date().toISOString();
  }

  function nullableNumber(value) {
    return value === null || value === undefined || value === "" ? null : Number(value);
  }

  function uniqueName(name, table) {
    return name + " Import " + new Date().toISOString().replace(/[:.]/g, "-");
  }

  function execSql(sql) {
    state.db.exec(sql);
  }

  function runSql(sql, params) {
    state.db.run(sql, params || []);
  }

  function queryAll(sql, params) {
    const stmt = state.db.prepare(sql, params || []);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function queryOne(sql, params) {
    return queryAll(sql, params)[0] || null;
  }

  function getLastInsertId() {
    return queryOne("SELECT last_insert_rowid() AS id").id;
  }

  function persistDb() {
    const bytes = state.db.export();
    localStorage.setItem(DB_STORAGE_KEY, bytesToBase64(bytes));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach(function (byte) {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}());
