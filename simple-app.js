
(function () {
  const q = (root, selector) => root.querySelector(selector);

  const qa = (root, selector) =>
    Array.from(root.querySelectorAll(selector));
  
const HISTORY_KEY = "unitv_config_used_ids_v1";

const CONFIG_RECORDS_KEY = "unitv_config_records_v1";
const ALLOWED_TOKEN_ENDINGS = ["2B78", "6E38", "4134", "4536", "4855", "5732", "6930", "7161", "7453"];


function extractConfigKeys(content) {
  const keys = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(key_n_bt|key_device_id_unitvfree|key_sn_token_unitvfree)\s*=(.*)$/);
    if (match) keys[match[1]] = match[2].trim();
  }
  return keys;
}


function isAllowedConfigRecord(record) {
  if (!record || typeof record.content !== "string" || !record.content) return false;
  const token = String(extractConfigKeys(record.content).key_sn_token_unitvfree || "").trim().toUpperCase();
  return ALLOWED_TOKEN_ENDINGS.some(ending => token.endsWith(ending));
}

function readConfigRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG_RECORDS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) {
    throw new Error("Não foi possível ler o histórico de configurações.");
  }
}

function storeConfigRecord(config) {
  const records = readConfigRecords();
  const content = config.files?.[".config"];
  if (!content) throw new Error("Configuração sem arquivo .config.");
  const keys = extractConfigKeys(content);
  records.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mac: config.mac || q(document, "#single-mac")?.value || "",
    userId: config.user_id || q(document, "#single-user")?.value || "",
    deviceId: config.device_id_hex || "",
    filename: randomConfigFilename(),
    content,
    keys
  });
  localStorage.setItem(CONFIG_RECORDS_KEY, JSON.stringify(records));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}


function loadHistory() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(HISTORY_KEY) || "{}"
    );

    return {
      macs: new Set(saved.macs || []),
      users: new Set(saved.users || []),
      devices: new Set(saved.devices || [])
    };
  } catch (error) {
    console.error("Erro ao ler histórico:", error);
    throw new Error("Não foi possível ler o histórico.");
  }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify({
    macs: [...history.macs],
    users: [...history.users],
    devices: [...history.devices]
  }));
}

function randomUniqueMac(history) {
  // Primeiro aproveita os MACs ainda livres do prefixo original.
  const originalPrefix = "9C:00:D3:EC:AA:";
  const available = [];
  for (let i = 0; i < 256; i++) {
    const mac = originalPrefix + i.toString(16).padStart(2, "0").toUpperCase();
    if (!history.macs.has(mac)) available.push(mac);
  }
  if (available.length) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return available[random[0] % available.length];
  }
  // MACs localmente administrados: evita inventar prefixos de fabricantes.
  // O primeiro octeto 02 indica unicast/local.
  for (let attempt = 0; attempt < 10000; attempt++) {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    const mac = "02:" + [...bytes].map(byte => byte.toString(16).padStart(2, "0").toUpperCase()).join(":");
    if (!history.macs.has(mac)) return mac;
  }
  throw new Error("Não foi possível encontrar um MAC inédito.");
}

function randomUniqueUser(history) {
  for (let i = 0; i < 1000; i++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);

    const user = String(
      500000000 + (bytes[0] % 100000000)
    );

    if (!history.users.has(user)) return user;
  }

  throw new Error("Não foi possível gerar User ID único.");
}


  function downloadBlob(blob, filename) {
    // Dentro do APK Android
    if (
      window.AndroidFiles &&
      typeof window.AndroidFiles.saveFile === "function"
    ) {
      const reader = new FileReader();

      reader.onloadend = function () {
        const base64 = reader.result.split(",")[1];

        window.AndroidFiles.saveFile(
          base64,
          filename,
          blob.type || "application/octet-stream"
        );
      };

      reader.onerror = function () {
        console.error("Erro ao preparar arquivo");
      };

      reader.readAsDataURL(blob);
      return;
    }

    // Download normal no navegador
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.style.display = "none";

    document.body.append(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function randomConfigFilename() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const suffix = Math.floor(1000 + Math.random() * 9000);
    return `CONFIG_${stamp}_${suffix}.config`;
  }

  function zipEntries(config) {
    const folder = ConfigCore.sanitizeFolder(config.folder_name || "CONFIG");
    const entries = Object.entries(config.files || {})
      .filter(([, content]) => content !== undefined && content !== null && content !== "")
      .map(([name, content]) => ({ name: `${folder}/${name}`, content }));
    if (config.files && config.files[".config"]) {
      entries.push({ name: `${folder}/Android/.config`, content: config.files[".config"] });
    }
    return entries;
  }

  async function saveConfig(config) {
    if (typeof window.showDirectoryPicker !== "function") {
      downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
      return "zip";
    }

    let root;
    try {
      root = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error.name === "AbortError") return "cancelled";
      downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
      return "zip";
    }

    const folder = await root.getDirectoryHandle(ConfigCore.sanitizeFolder(config.folder_name), { create: true });
    for (const [name, content] of Object.entries(config.files)) {
      if (!content) continue;
      const handle = await folder.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    }
    return "folder";
  }

  class ViewElement extends HTMLElement {
    toast(message, tone = "success") {
      this.dispatchEvent(new CustomEvent("studio-toast", {
        bubbles: true,
        detail: { message, tone }
      }));
    }
  }

  class SingleGeneratorView extends ViewElement {
    connectedCallback() {
      this.files = {};
      this.currentFile = ".config";
      this.filteredResults = [];
      this.filterRunning = false;
      this.filterStopRequested = false;
      this.innerHTML = `
        <div class="generator-layout">
          <section class="panel panel-pad">
            
            <div class="form-stack" style="margin-top:16px">
              <div class="field-grid">
                <div class="field"><label for="single-mac">Endereço MAC</label><input id="single-mac" value="9C:00:D3:EC:AB:AA" spellcheck="false" autocomplete="off"></div>
                <div class="field"><label for="single-user">User ID</label><input id="single-user" value="538746151" inputmode="numeric" spellcheck="false"></div>
              </div>
              <div class="field"><label for="single-device">Device ID em Base64</label><input id="single-device" placeholder="Gerado automaticamente" spellcheck="false" autocomplete="off"></div>
              <div class="field-grid">
                <div class="field"><label for="single-folder">Nome da pasta</label><input id="single-folder" value="CONFIG_1"></div>
                <div class="field"><label for="single-channel">Código do canal</label><input id="single-channel" value="SBTHD"></div>
              </div>
              <div class="button-row">
                <button class="button button-primary" data-action="generate-config">Gerar config</button>
              </div>
              <div class="form-divider"></div>
              <h3>Gerar configs por final da key</h3>
              <p class="field-hint">Somente tokens <code>key_sn_token_unitvfree</code> terminados em: 7453, 4855, 6930, 4134, 4536, 5975, 554B ou 6D77. Não comprova ativação.</p>
              <div class="button-row">
                <button class="button button-primary" data-action="generate-filtered">Consultar configs filtradas no histórico</button>
                <button class="button button-outline" data-action="stop-filtered" disabled>Parar busca</button>
              </div>
              <p class="field-hint" data-filter-status aria-live="polite">Consulta dos arquivos .config já salvos. Nenhum MAC ou key será recriado.</p>
              <div data-filter-results></div>
              <p class="field-hint">A configuração é montada neste navegador. Nenhum campo é enviado a um servidor.</p>
              <div class="form-divider"></div>
              <div class="button-row">
                <button class="button button-primary" data-action="save-folder">Salvar arquivos</button>
                <button class="button button-outline" data-action="download-config">Baixar .config</button>
              </div>
            </div>
          </section>

          <section class="panel preview-panel" aria-label="Pré-visualização dos arquivos">
            <div class="preview-top">
              <div class="preview-tabs" role="tablist" aria-label="Arquivo para visualizar">
                <button class="preview-tab" aria-selected="true" data-file=".config">.config</button>
                <button class="preview-tab" aria-selected="false" data-file=".properties">.properties</button>
                <button class="preview-tab" aria-selected="false" data-file="cache.config.xml">cache.config.xml</button>
              </div>
              <div class="preview-actions">
                <button class="button button-outline" data-action="copy">Copiar</button>
                <button class="button button-outline" data-action="download-current">Baixar arquivo</button>
                <button class="button button-accent" data-action="download-zip">Baixar ZIP</button>
              </div>
            </div>
            <pre class="code-preview" data-preview aria-live="polite"></pre>
            <div class="preview-foot"><span data-preview-name>.config</span><span data-preview-size>0 bytes</span></div>
          </section>
        </div>`;

      this.generate();
      this.addEventListener("click", event => this.onClick(event));
      this.addEventListener("input", event => {
        if (event.target.matches("input")) this.generate();
      });
    }

    makeConfig() {
      const deviceLabel = q(this, "#single-device").value.trim();
      const deviceId = deviceLabel
        ? Array.from(new TextEncoder().encode(deviceLabel), byte => byte.toString(16).padStart(2, "0")).join("")
        : undefined;
      return ConfigCore.generateConfig({
        mac: q(this, "#single-mac").value,
        userId: q(this, "#single-user").value,
        folder: q(this, "#single-folder").value,
        channelCode: q(this, "#single-channel").value,
        deviceId
      });
    }

    generate() {
      try {
        const config = this.makeConfig();
        this.files = config.files;
        if (!q(this, "#single-device").value) {
          q(this, "#single-device").value = ConfigCore.decodeHex(config.device_id_hex).text;
        }
        this.updatePreview();
        return config;
      } catch (error) {
        q(this, "[data-preview]").textContent = error.message;
        q(this, "[data-preview-size]").textContent = "Entrada inválida";
        return null;
      }
    }

    updatePreview() {
      const content = this.files[this.currentFile] || "";
      q(this, "[data-preview]").textContent = content;
      q(this, "[data-preview-name]").textContent = this.currentFile;
      q(this, "[data-preview-size]").textContent = `${new TextEncoder().encode(content).length.toLocaleString("pt-BR")} bytes`;
      qa(this, ".preview-tab").forEach(button => {
        button.setAttribute("aria-selected", String(button.dataset.file === this.currentFile));
      });
    }

    onClick(event) {
      const fileTab = event.target.closest("[data-file]");
      if (fileTab) {
        this.currentFile = fileTab.dataset.file;
        this.updatePreview();
        return;
      }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "generate-config") {
        try {
          const history = loadHistory();
          // Inclui os registros salvos mesmo se o índice de IDs estiver incompleto.
          for (const record of readConfigRecords()) {
            if (record.mac) history.macs.add(String(record.mac).trim().toUpperCase());
            if (record.userId) history.users.add(String(record.userId));
            if (record.deviceId) history.devices.add(String(record.deviceId));
          }
          const oldValues = ["#single-mac", "#single-user", "#single-folder", "#single-device"]
            .map(selector => q(this, selector).value);
          const mac = randomUniqueMac(history);
          const userId = randomUniqueUser(history);
          let config = null;
          try {
            q(this, "#single-mac").value = mac;
            q(this, "#single-user").value = userId;
            q(this, "#single-folder").value =
              `CONFIG_${Date.now()}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
            for (let attempt = 0; attempt < 100; attempt++) {
              q(this, "#single-device").value = "";
              config = this.makeConfig();
              if (!history.devices.has(config.device_id_hex)) break;
              config = null;
            }
            if (!config) throw new Error("Não foi possível gerar Device ID inédito.");
            history.macs.add(mac);
            history.users.add(userId);
            history.devices.add(config.device_id_hex);
            // Grava primeiro o arquivo e as keys; se o armazenamento estiver cheio,
            // a geração não é marcada como concluída.
            storeConfigRecord(config);
            try {
              saveHistory(history);
            } catch (error) {
              const records = readConfigRecords();
              records.pop();
              localStorage.setItem(CONFIG_RECORDS_KEY, JSON.stringify(records));
              throw error;
            }
          } catch (error) {
            ["#single-mac", "#single-user", "#single-folder", "#single-device"]
              .forEach((selector, index) => { q(this, selector).value = oldValues[index]; });
            throw error;
          }
          this.files = config.files;
          q(this, "#single-device").value = ConfigCore.decodeHex(config.device_id_hex).text;
          this.updatePreview();
          this.toast("Nova config gerada e registrada no histórico.");
        } catch (error) {
          console.error("Erro ao gerar configuração:", error);
          this.toast(error.message || "Erro ao gerar configuração.", "error");
        }
        return;
      }
      if (action === "generate-filtered") { this.generateFiltered(); return; }
      if (action === "stop-filtered") { this.filterStopRequested = true; return; }
      if (action === "download-filtered") {
        const index = Number(event.target.closest("[data-filter-index]")?.dataset.filterIndex);
        const record = this.filteredResults[index];
        if (!record) return this.toast("Arquivo não encontrado.", "error");
        downloadBlob(new Blob([record.content], { type: "application/octet-stream" }), record.filename);
        this.toast("Download individual iniciado.");
        return;
      }
      if (action === "copy") this.copyCurrent();
      if (action === "download-current") this.downloadCurrent();
      if (action === "download-config") this.downloadConfig();
      if (action === "download-zip") this.downloadZip();
      if (action === "save-folder") this.saveFolder();
    }

    async generateFiltered() {
      if (this.filterRunning) return;
      this.filterRunning = true;
      this.filterStopRequested = false;
      this.filteredResults = [];
      const status = q(this, "[data-filter-status]");
      const results = q(this, "[data-filter-results]");
      const start = q(this, '[data-action="generate-filtered"]');
      const stop = q(this, '[data-action="stop-filtered"]');
      start.disabled = true;
      stop.disabled = false;
      results.replaceChildren();
      try {
        const history = loadHistory();
        const saved = readConfigRecords();
        const prefix = "9C:00:D3:EC:AA:";
        const eligible = [];
        const usedEligible = new Set();
        const endingCounts = Object.fromEntries(ALLOWED_TOKEN_ENDINGS.map(end => [end, 0]));
        for (let i = 0; i < 256; i++) {
          const mac = prefix + i.toString(16).padStart(2, "0").toUpperCase();
          const ending = ConfigCore.encodeSnToken(mac).hex.slice(-4).toUpperCase();
          if (!ALLOWED_TOKEN_ENDINGS.includes(ending)) continue;
          endingCounts[ending]++;
          eligible.push({ mac, ending });
          if (history.macs.has(mac)) usedEligible.add(mac);
        }
        const savedByMac = new Map();
        for (const record of saved) {
          const mac = String(record.mac || "").trim().toUpperCase();
          if (!mac || typeof record.content !== "string" || !record.content) continue;
          const keys = extractConfigKeys(record.content);
          const token = String(keys.key_sn_token_unitvfree || "").toUpperCase();
          const ending = ALLOWED_TOKEN_ENDINGS.find(end => token.endsWith(end));
          if (!ending) continue;
          if (!savedByMac.has(mac)) savedByMac.set(mac, []);
          savedByMac.get(mac).push({ record, ending });
        }
        const available = eligible.filter(item => !history.macs.has(item.mac));
        const savedMatches = Array.from(savedByMac.values()).flat();
        const legacyOnly = eligible.filter(item => history.macs.has(item.mac) && !savedByMac.has(item.mac));
        const summary = document.createElement("p");
        summary.className = "field-hint";
        summary.textContent = `${eligible.length} MACs compatíveis · ${usedEligible.size} já usados · ${available.length} disponíveis · ${savedMatches.length} arquivos .config recuperáveis · ${legacyOnly.length} MACs usados sem arquivo salvo.`;
        results.append(summary);
        const details = document.createElement("details");
        const heading = document.createElement("summary");
        heading.textContent = "Quantidade por final da key";
        const values = document.createElement("p");
        values.textContent = ALLOWED_TOKEN_ENDINGS.map(end => `${end}: ${endingCounts[end]}`).join(" · ");
        details.append(heading, values);
        results.append(details);
        for (const {record, ending} of savedMatches) {
          if (this.filterStopRequested) break;
          const filename = record.filename || randomConfigFilename();
          const index = this.filteredResults.push({ content: record.content, filename, ending }) - 1;
          const article = document.createElement("article");
          article.className = "panel";
          article.style.cssText = "padding:12px;margin:10px 0;overflow-wrap:anywhere";
          const title = document.createElement("p");
          title.textContent = `Salva — MAC ${record.mac} — final ${ending} — ${filename}`;
          const button = document.createElement("button");
          button.className = "button button-outline";
          button.textContent = "Baixar .config individual";
          button.dataset.action = "download-filtered";
          button.dataset.filterIndex = String(index);
          article.append(title, button);
          results.append(article);
        }
        if (legacyOnly.length) {
          const warning = document.createElement("p");
          warning.className = "field-hint";
          warning.textContent = `${legacyOnly.length} MACs compatíveis constam como usados, mas não possuem arquivo .config salvo neste navegador. Não é possível recuperar o arquivo original somente pelo histórico de MACs.`;
          results.append(warning);
        }
        if (!savedMatches.length) {
          const notice = document.createElement("p");
          notice.textContent = "Nenhum arquivo .config compatível está armazenado neste navegador. O histórico de identificadores, sozinho, não contém os arquivos originais.";
          results.append(notice);
        }
        status.textContent = `${this.filterStopRequested ? "Consulta interrompida" : "Consulta concluída"}: ${savedMatches.length} arquivos salvos encontrados; ${available.length} MACs compatíveis ainda disponíveis. Nenhum identificador foi alterado.`;
      } catch (error) {
        status.textContent = `Falha na consulta: ${error.message}`;
        this.toast(error.message || "Erro ao consultar histórico.", "error");
      } finally {
        this.filterRunning = false;
        start.disabled = false;
        stop.disabled = true;
      }
    }

    currentConfig() {
      // Usa os dados exibidos, sem sortear novos identificadores ao baixar.
      return this.makeConfig();
    }

    async copyCurrent() {
      const content = this.files[this.currentFile] || "";
      try {
        await navigator.clipboard.writeText(content);
      } catch (_) {
        const field = document.createElement("textarea");
        field.value = content;
        document.body.append(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      this.toast("Conteúdo copiado.");
    }

    downloadCurrent() {
      if (this.currentFile === ".config") return this.downloadConfig();
      const content = this.files[this.currentFile] || "";
      if (!content) return this.toast("Gere a configuração primeiro.", "error");
      downloadBlob(new Blob([content], { type: "application/octet-stream" }), this.currentFile);
      this.toast(`${this.currentFile} baixado.`);
    }

    downloadConfig() {
      try {
        const config = this.currentConfig();
        if (!config.files[".config"]) throw new Error("Arquivo .config vazio.");
        downloadBlob(new Blob([config.files[".config"]], { type: "application/octet-stream" }), randomConfigFilename());
        this.toast("Arquivo .config enviado para download.");
      } catch (error) {
        this.toast(`Falha no download: ${error.message}`, "error");
      }
    }

    downloadZip() {
      try {
        const config = this.currentConfig();
        downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
        this.toast("Pacote ZIP enviado para download.");
      } catch (error) {
        this.toast(`Falha no ZIP: ${error.message}`, "error");
      }
    }

    async saveFolder() {
      try {
        const config = this.currentConfig();
        const result = await saveConfig(config);
        if (result === "folder") this.toast(`Arquivos salvos na pasta ${config.folder_name}.`);
        if (result === "zip") this.toast("Download do ZIP iniciado.");
      } catch (error) {
        this.toast(`Falha ao salvar: ${error.message}`, "error");
      }
    }
  }

  class HistoryView extends ViewElement {
    connectedCallback() {
      this.innerHTML = `
        <section class="panel panel-pad" style="padding:20px">
          <h2>Histórico de Keys</h2>
          <p class="field-hint">Registros deste navegador, a partir desta atualização. Tokens são dados sensíveis: não compartilhe capturas com as keys visíveis.</p>
          <div class="field" style="margin:16px 0">
            <label for="history-search">Pesquisar MAC, User ID ou token</label>
            <input id="history-search" placeholder="Digite o identificador ou a key" autocomplete="off">
          </div>
          <div class="button-row" style="margin:12px 0">
            <button class="button button-primary" data-action="export-history" type="button">Exportar Filtradas em ZIP (.config)</button>
            <button class="button button-outline" data-action="clear-history" type="button" style="border-color:#b91c1c;color:#b91c1c">Limpar Histórico</button>
          </div>
          <p class="field-hint">Exibe e exporta somente .config cujo key_sn_token_unitvfree termina em: ${ALLOWED_TOKEN_ENDINGS.join(", ")}. O histórico completo continua armazenado; não altera registros.</p>
          <p data-history-count></p>
          <div data-history-results></div>
        </section>`;
      this.querySelector("#history-search").addEventListener("input", () => this.render());
      this.addEventListener("click", event => {
        if (event.target.closest('[data-action="clear-history"]')) {
          const count = readConfigRecords().length;
          if (!window.confirm(`ATENÇÃO: Apagar ${count} configurações salvas e todos os MACs, User IDs e Device IDs usados neste navegador? Esta ação não pode ser desfeita. Faça backup antes de continuar.`)) return;
          if (!window.confirm("Confirma a exclusão DEFINITIVA do Histórico de Keys?")) return;
          try {
            localStorage.removeItem(CONFIG_RECORDS_KEY);
            localStorage.removeItem(HISTORY_KEY);
            this.querySelector("#history-search").value = "";
            this.render();
            this.toast("Histórico de Keys apagado deste navegador.");
          } catch (error) {
            this.toast(`Falha ao limpar histórico: ${error.message}`, "error");
          }
          return;
        }
        if (event.target.closest('[data-action="export-history"]')) {
          try {
            const records = readConfigRecords().filter(isAllowedConfigRecord);
            if (!records.length) {
              this.toast("Nenhuma configuração filtrada salva neste navegador.", "error");
              return;
            }
            // Cada registro salvo vira um arquivo .config individual no ZIP.
            // Nomes sequenciais evitam colisões e não expõem keys no nome.
            const entries = records.map((record, index) => {
              const ending = String(extractConfigKeys(record.content).key_sn_token_unitvfree || "")
                .trim().toUpperCase().slice(-4);
              return {
                name: `CONFIG_${String(index + 1).padStart(4, "0")}_FINAL_${ending}.config`,
                content: record.content
              };
            });
            const filename = `CONFIGS_FILTRADAS_${new Date().toISOString().slice(0, 10)}.zip`;
            downloadBlob(ConfigCore.createZip(entries), filename);
            this.toast(`${records.length} arquivos .config individuais exportados em ZIP.`);
          } catch (error) {
            this.toast(`Falha ao exportar histórico: ${error.message}`, "error");
          }
          return;
        }
        const button = event.target.closest("[data-history-download]");
        if (!button) return;
        const record = readConfigRecords().find(r => r.id === button.dataset.historyDownload);
        if (!record) return this.toast("Registro não encontrado.", "error");
        downloadBlob(new Blob([record.content], { type: "application/octet-stream" }), record.filename);
        this.toast("Download do arquivo .config iniciado.");
      });
      this.render();
    }

    render() {
      let records;
      try { records = readConfigRecords(); }
      catch (error) {
        q(this, "[data-history-count]").textContent = error.message;
        return;
      }
      const search = q(this, "#history-search").value.trim().toLowerCase();
      const filtered = records.filter(isAllowedConfigRecord);
      const matches = filtered.filter(r => [r.mac, r.userId, r.deviceId,
        ...Object.values(extractConfigKeys(r.content))].some(v => String(v || "").toLowerCase().includes(search)));
      q(this, "[data-history-count]").textContent = `${matches.length} de ${filtered.length} configurações filtradas (${records.length} no histórico total)`;
      q(this, "[data-history-results]").innerHTML = matches.length ? matches.slice().reverse().map(r => {
        const keys = extractConfigKeys(r.content);
        return `
        <article class="panel" style="padding:16px;margin:12px 0;overflow-wrap:anywhere">
          <p><strong>${escapeHtml(new Date(r.createdAt).toLocaleString("pt-BR"))}</strong></p>
          <p><strong>MAC:</strong> ${escapeHtml(r.mac)} | <strong>User ID:</strong> ${escapeHtml(r.userId)}</p>
          <p><strong>Device ID:</strong> ${escapeHtml(r.deviceId)}</p>
          <details><summary>Mostrar keys</summary>
            <p><strong>key_n_bt</strong><br><code>${escapeHtml(keys.key_n_bt || "Não encontrada")}</code></p>
            <p><strong>key_device_id_unitvfree</strong><br><code>${escapeHtml(keys.key_device_id_unitvfree || "Não encontrada")}</code></p>
            <p><strong>key_sn_token_unitvfree</strong><br><code>${escapeHtml(keys.key_sn_token_unitvfree || "Não encontrada")}</code></p>
          </details>
          <button class="button button-outline" style="margin-top:12px" data-history-download="${escapeHtml(r.id)}">Baixar .config novamente</button>
        </article>`;
      }).join("") : "<p>Nenhuma configuração encontrada com os finais escolhidos.</p>";
    }
  }

  class AppsView extends ViewElement {
    connectedCallback() {
      this.innerHTML = `
        <section class="section-head"><div><p class="eyebrow">PACOTES LOCAIS</p><h2>Aplicativos</h2><p>APKs disponíveis na pasta de recursos ao lado desta versão.</p></div></section>
        <div class="apk-grid">
          <article class="apk-item"><div><span class="apk-type">Versão recomendada</span><h3>UniTV Free 5.9.0</h3></div><p>Versão mais recente listada no repositório local.</p><a class="button button-primary" href="apps/UniTV%20Free%205.9.0.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Versão clássica</span><h3>UniTV Free 5.8.0</h3></div><p>Versão anterior mantida para compatibilidade com dispositivos.</p><a class="button button-primary" href="apps/UniTV%20Free%205.8.0.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Aplicativo Ativa</span><h3>Ativa.apk</h3></div><p>Baixe o aplicativo Ativa pelo GitHub Releases.</p><a class="button button-primary" href="https://github.com/nilsonbastos/unitv-config/releases/download/v1.0/ativa.apk">Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Ferramenta</span><h3>Ativador UniTV Free</h3></div><p>Seleciona um <code>.config</code> e o copia para <code>Android/.config</code>, substituindo o arquivo existente.</p><a class="button button-primary" href="apps/ativadorUniTVFree.apk" download>Baixar APK</a></article>
        </div>
        <section class="manual-guide" aria-labelledby="manual-guide-title">
          <div class="section-head"><div><p class="eyebrow">TROCA MANUAL</p><h2 id="manual-guide-title">Substituir o .config no Android</h2><p>Use estas etapas quando preferir copiar o arquivo pelo gerenciador de arquivos do dispositivo.</p></div></div>
          <div class="manual-guide-grid">
            <article class="manual-card"><span class="manual-step">01</span><h3>Abra o armazenamento</h3><p>Feche o UniTV Free. No gerenciador de arquivos, abra o armazenamento interno e acesse <code>Android</code>. O destino costuma ser <code>/storage/emulated/0/Android/</code>.</p></article>
            <article class="manual-card"><span class="manual-step">02</span><h3>Exiba arquivos ocultos</h3><p>Ative “Mostrar arquivos ocultos” nas opções do gerenciador. Como o nome começa com ponto, o arquivo <code>.config</code> fica oculto por padrão.</p></article>
            <article class="manual-card"><span class="manual-step">03</span><h3>Substitua e reabra</h3><p>Faça uma cópia do arquivo atual se precisar preservá-lo. Copie o novo arquivo para a pasta <code>Android</code> e renomeie-o exatamente para <code>.config</code>, confirmando a substituição. Depois, abra o UniTV Free novamente.</p></article>
          </div>
          <p class="manual-guide-note">Algumas versões do Android ou gerenciadores de arquivos restringem a pasta <code>Android</code>. Se não conseguir gravar nela, tente outro gerenciador com permissão para acessar o armazenamento compartilhado.</p>
        </section>`;
    }
  }

  class StudioApp extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <header class="topbar"><div class="topbar-inner">
          <div class="brand"><img src="img/logo.webp" alt=""><div><div class="brand-name">Plataforma de Configurações</div><div class="brand-kicker">ferramentas locais</div></div></div>
          <div class="local-signal" title="Execução no navegador">Gerando Config...</div>
        </div></header>
        <main class="workspace">
          <div class="page-heading"><div><p class="eyebrow">CONFIGURAÇÕES</p><h1 data-page-title>Gerador .config / Nilson Bastos</h1></div><p class="heading-note" data-page-note>Gerador de arquivo 2027</p></div>
          <nav class="view-tabs" aria-label="Seções">
            <button class="view-tab" data-view="generator" aria-selected="true">Gerador 2027</button>
            <button class="view-tab" data-view="apps" aria-selected="false">Aplicativos</button>
              <button class="view-tab" data-view="history" aria-selected="false">Histórico de Keys</button>
          </nav>
          <section class="view-panel" data-panel="generator"><single-generator-view></single-generator-view></section>
          <section class="view-panel" data-panel="apps" hidden><apps-view></apps-view></section>
          <section class="view-panel" data-panel="history" hidden><history-view></history-view></section>
          <footer class="footer-note">
            <span>HTML5 · CSS3 · JS Vanilla· Web Components</span>
            <nav class="footer-actions" aria-label="Links do projeto">
              <a class="support-link" href="https://w.app/wm8bxj" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                Contribuir no GitHub
              </a>
              <a class="support-link support-pix" href="https://w.app/wm8bxj" target="_blank" rel="noopener noreferrer">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7-4.35-9.33-8.28C.4 8.5 3.4 4 7.9 4c1.7 0 3.2.8 4.1 2.1C12.9 4.8 14.4 4 16.1 4c4.5 0 7.5 4.5 5.2 8.72C19 16.65 12 21 12 21Z"/></svg>
                Apoiar via Pix
              </a>
            </nav>
          </footer>
        </main>
        <div class="toast" role="status" aria-live="polite"></div>`;

      this.addEventListener("click", event => this.onNavigation(event));
      this.addEventListener("studio-toast", event => this.showToast(event.detail));
    }

    onNavigation(event) {
      const button = event.target.closest("[data-view]");
      if (!button) return;
      qa(this, "[data-view]").forEach(tab => tab.setAttribute("aria-selected", String(tab === button)));
      qa(this, "[data-panel]").forEach(panel => { panel.hidden = panel.dataset.panel !== button.dataset.view; });
      const view = button.dataset.view;
      q(this, "[data-page-title]").textContent = view === "apps" ? "Aplicativos" : view === "history" ? "Histórico de Keys" : "Gerador individual";
      q(this, "[data-page-note]").textContent = view === "apps"
        ? "Baixe os pacotes disponíveis na pasta local de aplicativos."
        : view === "history" ? "Pesquise as configurações salvas neste navegador."
        : "Gere, revise e salve arquivos diretamente no navegador. Os valores ficam no dispositivo.";
      if (view === "history") q(this, "history-view")?.render();
    }

    showToast(detail) {
      const toast = q(this, ".toast");
      toast.textContent = detail.message;
      toast.dataset.tone = detail.tone || "success";
      toast.dataset.visible = "true";
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { toast.dataset.visible = "false"; }, 3400);
    }
  }

  customElements.define("single-generator-view", SingleGeneratorView);
  customElements.define("apps-view", AppsView);
  customElements.define("history-view", HistoryView);
  customElements.define("studio-app", StudioApp);
})();