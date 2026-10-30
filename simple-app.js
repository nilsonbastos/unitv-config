(function () {
  "use strict";
  const q = (root, selector) => root.querySelector(selector);
  const qa = (root, selector) => Array.from(root.querySelectorAll(selector));
  const HISTORY_KEY = "unitv_config_used_ids_v1";
  const CONFIG_RECORDS_KEY = "unitv_config_records_v1";
  const ALLOWED_TOKEN_ENDINGS = ["7453", "4855", "6930", "4134", "4536"];
  // Os tres primeiros bytes permanecem fixos; os dois seguintes variam.
  // O ultimo byte determina o final do token pelo algoritmo do core.js.
  const MAC_OUI_PREFIX = "9C:00:D3:";
  let compatibleLastBytesCache = null;

  function extractConfigKeys(content) {
    const keys = {};
    for (const line of String(content || "").split(/\r?\n/)) {
      const match = line.match(/^\s*(key_n_bt|key_device_id_unitvfree|key_sn_token_unitvfree)\s*=(.*)$/);
      if (match) keys[match[1]] = match[2].trim();
    }
    return keys;
  }
  function tokenEnding(content) {
    return String(extractConfigKeys(content).key_sn_token_unitvfree || "").trim().toUpperCase().slice(-4);
  }
  function isAllowedConfig(config) {
    return ALLOWED_TOKEN_ENDINGS.includes(tokenEnding(config.files?.[".config"]));
  }
  function configFilenameFor(content, number) {
    const last = tokenEnding(content);
    const ending = /^[0-9A-F]{4}$/.test(last) ? last : "SEM_FINAL";
    return `CONFIG_${String(number).padStart(4, "0")}_FINAL_${ending}.config`;
  }
  function readConfigRecords() {
    const data = JSON.parse(localStorage.getItem(CONFIG_RECORDS_KEY) || "[]");
    if (!Array.isArray(data)) throw new Error("Histórico inválido.");
    return data;
  }
  function storeConfigRecord(config) {
    if (!isAllowedConfig(config)) throw new Error("Key fora dos cinco finais permitidos. Nada foi salvo.");
    const records = readConfigRecords();
    const content = config.files[".config"];
    const record = {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(),
      mac: config.mac || "", userId: config.user_id || "", deviceId: config.device_id_hex || "",
      filename: configFilenameFor(content, records.length + 1), content, keys: extractConfigKeys(content)
    };
    records.push(record);
    localStorage.setItem(CONFIG_RECORDS_KEY, JSON.stringify(records));
    return record;
  }
  function individualConfigFilename(record) {
    const records = readConfigRecords();
    const position = records.findIndex(item => item.id === record.id);
    return configFilenameFor(record.content || "", position >= 0 ? position + 1 : records.length + 1);
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function loadHistory() {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
    return { macs: new Set(saved.macs || []), users: new Set(saved.users || []), devices: new Set(saved.devices || []) };
  }
  function saveHistory(history) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({
      macs: [...history.macs], users: [...history.users], devices: [...history.devices]
    }));
  }
  function secureIndex(length) {
    const bytes = new Uint32Array(1);
    const limit = Math.floor(4294967296 / length) * length;
    do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
    return bytes[0] % length;
  }
  function compatibleLastBytes() {
    if (compatibleLastBytesCache) return compatibleLastBytesCache;
    const values = [];
    for (let i = 0; i < 256; i++) {
      const lastByte = i.toString(16).padStart(2, "0").toUpperCase();
      const tokenHex = ConfigCore.encodeSnToken(`${MAC_OUI_PREFIX}EC:AA:${lastByte}`).hex.toUpperCase();
      if (ALLOWED_TOKEN_ENDINGS.includes(tokenHex.slice(-4))) values.push(lastByte);
    }
    if (!values.length) throw new Error("O core.js não produz os cinco finais selecionados.");
    compatibleLastBytesCache = values;
    return values;
  }

  function randomUniqueMacFiltered(history) {
    const endings = compatibleLastBytes();
    const byteHex = number => number.toString(16).padStart(2, "0").toUpperCase();
    // 256 x 256 x 80 = 5.242.880 MACs possíveis com este core.js.
    // Tentativas aleatórias evitam percorrer milhões de endereços a cada clique.
    for (let attempt = 0; attempt < 2000; attempt++) {
      const fourth = byteHex(secureIndex(256));
      const fifth = byteHex(secureIndex(256));
      const last = endings[secureIndex(endings.length)];
      const mac = `${MAC_OUI_PREFIX}${fourth}:${fifth}:${last}`;
      if (!history.macs.has(mac)) return mac;
    }
    throw new Error("Não foi encontrado um novo MAC após várias tentativas. Verifique seu histórico.");
  }
  function randomUniqueUser(history) {
    for (let i = 0; i < 1000; i++) {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const user = String(500000000 + (bytes[0] % 100000000));
      if (!history.users.has(user)) return user;
    }
    throw new Error("Não foi possível gerar User ID único.");
  }
  function downloadBlob(blob, filename) {
    if (window.AndroidFiles && typeof window.AndroidFiles.saveFile === "function") {
      const reader = new FileReader();
      reader.onloadend = () => window.AndroidFiles.saveFile(reader.result.split(",")[1], filename, blob.type || "application/octet-stream");
      reader.onerror = () => console.error("Erro ao preparar arquivo");
      reader.readAsDataURL(blob);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.style.display = "none";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function zipEntries(config) {
    const folder = ConfigCore.sanitizeFolder(config.folder_name || "CONFIG");
    const entries = Object.entries(config.files || {})
      .filter(([, content]) => content !== undefined && content !== null && content !== "")
      .map(([name, content]) => ({ name: `${folder}/${name}`, content }));
    if (config.files?.[".config"]) entries.push({ name: `${folder}/Android/.config`, content: config.files[".config"] });
    return entries;
  }
  async function saveConfig(config) {
    if (typeof window.showDirectoryPicker !== "function") {
      downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
      return "zip";
    }
    let root;
    try { root = await window.showDirectoryPicker({ mode: "readwrite" }); }
    catch (error) {
      if (error.name === "AbortError") return "cancelled";
      downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
      return "zip";
    }
    const folder = await root.getDirectoryHandle(ConfigCore.sanitizeFolder(config.folder_name), { create: true });
    for (const [name, content] of Object.entries(config.files)) {
      if (!content) continue;
      const handle = await folder.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content); await writable.close();
    }
    return "folder";
  }
  class ViewElement extends HTMLElement {
    toast(message, tone = "success") {
      this.dispatchEvent(new CustomEvent("studio-toast", { bubbles: true, detail: { message, tone } }));
    }
  }
  class SingleGeneratorView extends ViewElement {
    connectedCallback() {
      this.files = {};
      this.currentFile = ".config";
      this.acceptedConfig = null;
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
              <div class="button-row"><button class="button button-primary" data-action="generate-config">Gerar config</button></div>
              <p class="field-hint">Somente finais 7453, 4855, 6930, 4134 ou 4536. Cada MAC e Device ID gerado é novo; o token pode se repetir, pois depende apenas do último byte do MAC. Os dados ficam neste navegador.</p>
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
      this.addEventListener("click", event => this.onClick(event));
      this.addEventListener("input", event => {
        if (event.target.matches("input")) {
          this.acceptedConfig = null;
          this.files = {};
          this.updatePreview();
        }
      });
      this.updatePreview();
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
    updatePreview() {
      const content = this.files[this.currentFile] || "";
      q(this, "[data-preview]").textContent = content;
      q(this, "[data-preview-name]").textContent = this.currentFile;
      q(this, "[data-preview-size]").textContent = `${new TextEncoder().encode(content).length.toLocaleString("pt-BR")} bytes`;
      qa(this, ".preview-tab").forEach(button => button.setAttribute("aria-selected", String(button.dataset.file === this.currentFile)));
    }
    onClick(event) {
      const fileTab = event.target.closest("[data-file]");
      if (fileTab) { this.currentFile = fileTab.dataset.file; this.updatePreview(); return; }
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "generate-config") {
        try {
          const history = loadHistory();
          const mac = randomUniqueMacFiltered(history);
          const userId = randomUniqueUser(history);
          const oldValues = ["#single-mac", "#single-user", "#single-folder", "#single-device"].map(selector => q(this, selector).value);
          let config;
          try {
            q(this, "#single-mac").value = mac;
            q(this, "#single-user").value = userId;
            q(this, "#single-folder").value = `CONFIG_${Date.now()}_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
            q(this, "#single-device").value = "";
            for (let attempt = 0; attempt < 100; attempt++) {
              q(this, "#single-device").value = "";
              config = this.makeConfig();
              if (!history.devices.has(config.device_id_hex)) break;
              config = null;
            }
            if (!config) throw new Error("Não foi possível gerar Device ID inédito.");
            if (!isAllowedConfig(config)) throw new Error("Final da key não permitido. Configuração não salva.");
            storeConfigRecord(config);
            try {
              history.macs.add(mac); history.users.add(userId); history.devices.add(config.device_id_hex);
              saveHistory(history);
            } catch (error) {
              const records = readConfigRecords();
              const index = records.findIndex(r => r.content === config.files[".config"]);
              if (index >= 0) { records.splice(index, 1); localStorage.setItem(CONFIG_RECORDS_KEY, JSON.stringify(records)); }
              throw error;
            }
          } catch (error) {
            ["#single-mac", "#single-user", "#single-folder", "#single-device"].forEach((selector, i) => { q(this, selector).value = oldValues[i]; });
            throw error;
          }
          this.acceptedConfig = config;
          this.files = config.files;
          q(this, "#single-device").value = ConfigCore.decodeHex(config.device_id_hex).text;
          this.updatePreview();
          this.toast(`Config com final ${tokenEnding(config.files[".config"])} gerada e registrada.`);
        } catch (error) {
          this.toast(error.message || "Erro ao gerar configuração.", "error");
        }
        return;
      }
      if (action === "copy") this.copyCurrent();
      if (action === "download-current") this.downloadCurrent();
      if (action === "download-config") this.downloadConfig();
      if (action === "download-zip") this.downloadZip();
      if (action === "save-folder") this.saveFolder();
    }
    currentConfig() {
      if (!this.acceptedConfig || !isAllowedConfig(this.acceptedConfig)) throw new Error("Clique em Gerar config para criar uma key com final permitido.");
      return this.acceptedConfig;
    }
    async copyCurrent() {
      const content = this.files[this.currentFile] || "";
      if (!content) return this.toast("Gere a configuração primeiro.", "error");
      try { await navigator.clipboard.writeText(content); }
      catch (_) {
        const field = document.createElement("textarea"); field.value = content;
        document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
      }
      this.toast("Conteúdo copiado.");
    }
    downloadCurrent() {
      if (this.currentFile === ".config") return this.downloadConfig();
      try {
        this.currentConfig();
        const content = this.files[this.currentFile] || "";
        if (!content) throw new Error("Arquivo vazio.");
        downloadBlob(new Blob([content], { type: "application/octet-stream" }), this.currentFile);
        this.toast(`${this.currentFile} baixado.`);
      } catch (error) { this.toast(error.message, "error"); }
    }
    downloadConfig() {
      try {
        const config = this.currentConfig();
        const records = readConfigRecords();
        const content = config.files[".config"];
        const index = records.findIndex(record => record.content === content);
        const filename = configFilenameFor(content, index >= 0 ? index + 1 : records.length + 1);
        downloadBlob(new Blob([content], { type: "application/octet-stream" }), filename);
        this.toast("Arquivo .config enviado para download.");
      } catch (error) { this.toast(`Falha no download: ${error.message}`, "error"); }
    }
    downloadZip() {
      try {
        const config = this.currentConfig();
        downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
        this.toast("Pacote ZIP enviado para download.");
      } catch (error) { this.toast(`Falha no ZIP: ${error.message}`, "error"); }
    }
    async saveFolder() {
      try {
        const config = this.currentConfig();
        const result = await saveConfig(config);
        if (result === "folder") this.toast(`Arquivos salvos na pasta ${config.folder_name}.`);
        if (result === "zip") this.toast("Download do ZIP iniciado.");
      } catch (error) { this.toast(`Falha ao salvar: ${error.message}`, "error"); }
    }
  }
  class HistoryView extends ViewElement {
    connectedCallback() {
      this.innerHTML = `
        <section class="panel panel-pad" style="padding:20px">
          <h2>Histórico de Keys</h2>
          <p class="field-hint">Registros salvos neste navegador. Não compartilhe capturas com as keys visíveis.</p>
          <div class="field" style="margin:16px 0">
            <label for="history-search">Pesquisar MAC, User ID ou token</label>
            <input id="history-search" placeholder="Digite o identificador ou a key" autocomplete="off">
          </div>
          <div class="field" style="margin:12px 0">
            <label for="history-ending">Filtrar final da key</label>
            <select id="history-ending" style="width:100%;padding:10px">
              <option value="allowed">Somente os 5 finais permitidos</option>
              <option value="7453">Final 7453</option>
              <option value="4855">Final 4855</option>
              <option value="6930">Final 6930</option>
              <option value="4134">Final 4134</option>
              <option value="4536">Final 4536</option>
              <option value="all">Todas as keys</option>
            </select>
          </div>
          <button class="button button-outline" data-history-clear style="margin:10px 0">Excluir histórico das keys</button>
          <p data-history-count></p><div data-history-results></div>
        </section>`;
      q(this, "#history-search").addEventListener("input", () => this.render());
      q(this, "#history-ending").addEventListener("change", () => this.render());
      this.addEventListener("click", event => {
        if (event.target.closest("[data-history-clear]")) {
          if (!window.confirm("Excluir permanentemente todo o histórico de keys deste navegador?")) return;
          if (!window.confirm("Confirma a exclusão? Essa ação não pode ser desfeita.")) return;
          try {
            localStorage.removeItem(CONFIG_RECORDS_KEY);
            localStorage.removeItem(HISTORY_KEY);
            this.render(); this.toast("Histórico de keys excluído.");
          } catch (error) { this.toast(`Falha ao excluir histórico: ${error.message}`, "error"); }
          return;
        }
        const button = event.target.closest("[data-history-download]");
        if (!button) return;
        try {
          const record = readConfigRecords().find(r => r.id === button.dataset.historyDownload);
          if (!record) throw new Error("Registro não encontrado.");
          downloadBlob(new Blob([record.content], { type: "application/octet-stream" }), individualConfigFilename(record));
          this.toast("Download do arquivo .config iniciado.");
        } catch (error) { this.toast(error.message, "error"); }
      });
      this.render();
    }
    render() {
      let records;
      try { records = readConfigRecords(); }
      catch (error) { q(this, "[data-history-count]").textContent = error.message; return; }
      const search = q(this, "#history-search").value.trim().toLowerCase();
      const selectedEnding = q(this, "#history-ending").value;
      const matches = records.filter(r => {
        const token = String(extractConfigKeys(r.content || "").key_sn_token_unitvfree || "").trim().toUpperCase();
        const ending = token.slice(-4);
        const allowed = selectedEnding === "all" ||
          (selectedEnding === "allowed" ? ALLOWED_TOKEN_ENDINGS.includes(ending) : ending === selectedEnding);
        return allowed && [r.mac, r.userId, r.deviceId, ...Object.values(r.keys || {}), token]
          .some(v => String(v || "").toLowerCase().includes(search));
      });
      q(this, "[data-history-count]").textContent = `${matches.length} de ${records.length} configurações registradas`;
      q(this, "[data-history-results]").innerHTML = matches.length ? matches.slice().reverse().map(r => `
        <article class="panel" style="padding:16px;margin:12px 0;overflow-wrap:anywhere">
          <p><strong>${escapeHtml(new Date(r.createdAt).toLocaleString("pt-BR"))}</strong></p>
          <p><strong>MAC:</strong> ${escapeHtml(r.mac)} | <strong>User ID:</strong> ${escapeHtml(r.userId)}</p>
          <p><strong>Device ID:</strong> ${escapeHtml(r.deviceId)}</p>
          <details><summary>Mostrar keys</summary>
            <p><strong>key_n_bt</strong><br><code>${escapeHtml(r.keys?.key_n_bt || "Não encontrada")}</code></p>
            <p><strong>key_device_id_unitvfree</strong><br><code>${escapeHtml(r.keys?.key_device_id_unitvfree || "Não encontrada")}</code></p>
            <p><strong>key_sn_token_unitvfree</strong><br><code>${escapeHtml(r.keys?.key_sn_token_unitvfree || "Não encontrada")}</code></p>
          </details>
          <button class="button button-outline" style="margin-top:12px" data-history-download="${escapeHtml(r.id)}">Baixar .config novamente</button>
        </article>`).join("") : "<p>Nenhuma configuração encontrada.</p>";
    }
  }
  class AppsView extends ViewElement {
    connectedCallback() {
      this.innerHTML = `
        <section class="section-head"><div><p class="eyebrow">PACOTES LOCAIS</p><h2>Aplicativos</h2><p>APKs disponíveis na pasta de recursos ao lado desta versão.</p></div></section>
        <div class="apk-grid">
          <article class="apk-item"><div><span class="apk-type">Versão recomendada</span><h3>UniTV Free 5.9.0</h3></div><p>Versão mais recente listada no repositório local.</p><a class="button button-primary" href="apps/UniTV%20Free%205.9.0.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Versão clássica</span><h3>UniTV Free 5.8.0</h3></div><p>Versão anterior mantida para compatibilidade com dispositivos.</p><a class="button button-primary" href="apps/UniTV%20Free%205.8.0.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Versão legada</span><h3>UniTV Free 5.1.0</h3></div><p>Pacote antigo disponível no diretório de aplicativos.</p><a class="button button-primary" href="apps/UniTV%20Free%205.1.0.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Ferramenta</span><h3>Ativador UniTV Free</h3></div><p>Seleciona um <code>.config</code> e o copia para <code>Android/.config</code>, substituindo o arquivo existente.</p><a class="button button-primary" href="apps/ativadorUniTVFree.apk" download>Baixar APK</a></article>
        </div>
        <section class="manual-guide" aria-labelledby="manual-guide-title">
          <div class="section-head"><div><p class="eyebrow">TROCA MANUAL</p><h2 id="manual-guide-title">Substituir o .config no Android</h2><p>Use estas etapas quando preferir copiar o arquivo pelo gerenciador de arquivos do dispositivo.</p></div></div>
          <div class="manual-guide-grid">
            <article class="manual-card"><span class="manual-step">01</span><h3>Abra o armazenamento</h3><p>Feche o UniTV Free. No gerenciador de arquivos, abra o armazenamento interno e acesse <code>Android</code>. O destino costuma ser <code>/storage/emulated/0/Android/</code>.</p></article>
            <article class="manual-card"><span class="manual-step">02</span><h3>Exiba arquivos ocultos</h3><p>Ative “Mostrar arquivos ocultos” nas opções do gerenciador. Como o nome começa com ponto, o arquivo <code>.config</code> fica oculto por padrão.</p></article>
            <article class="manual-card"><span class="manual-step">03</span><h3>Substitua e reabra</h3><p>Faça uma cópia do arquivo atual se precisar preservá-lo. Copie o novo arquivo para a pasta <code>Android</code> e renomeie-o exatamente para <code>.config</code>, confirmando a substituição. Depois, abra o UniTV Free novamente.</p></article>
          </div>
          <p class="manual-guide-note">Algumas versões do Android ou gerenciadores de arquivos restringem a pasta <code>Android</code>.</p>
        </section>`;
    }
  }
  class StudioApp extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `
        <header class="topbar"><div class="topbar-inner"><div class="brand"><img src="img/logo.webp" alt=""><div><div class="brand-name">Plataforma de Configurações</div><div class="brand-kicker">ferramentas locais</div></div></div><div class="local-signal" title="Execução no navegador">Gerando Config...</div></div></header>
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
          <footer class="footer-note"><span>HTML5 · CSS3 · JS Vanilla · Web Components</span>
            <nav class="footer-actions" aria-label="Links do projeto">
              <a class="support-link" href="https://w.app/wm8bxj" target="_blank" rel="noopener noreferrer">Contribuir no GitHub</a>
              <a class="support-link support-pix" href="https://w.app/wm8bxj" target="_blank" rel="noopener noreferrer">Apoiar via Pix</a>
            </nav>
          </footer>
        </main><div class="toast" role="status" aria-live="polite"></div>`;
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
