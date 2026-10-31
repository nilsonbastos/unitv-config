9(function () {
  "use strict";
  const q = (root, selector) => root.querySelector(selector);
  const qa = (root, selector) => Array.from(root.querySelectorAll(selector));
  const HISTORY_KEY = "unitv_config_used_ids_v1";
  const CONFIG_RECORDS_KEY = "unitv_config_records_v1";
  const ALLOWED_TOKEN_ENDINGS = ["7453", "4855", "6930", "4134", "4536"];
  // Os tres primeiros bytes permanecem fixos; os dois seguintes variam.
  // O ultimo byte determina o final do token pelo algoritmo do core.js.
  const MAC_OUI_PREFIX = "9C:00:D3:";
  let endingMapCache = null;

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
  function supportedEndingMap() {
    if (endingMapCache) return endingMapCache;
    const map = new Map();
    for (let i = 0; i < 256; i++) {
      const lastByte = i.toString(16).padStart(2, "0").toUpperCase();
      const tokenHex = ConfigCore.encodeSnToken(`${MAC_OUI_PREFIX}EC:AA:${lastByte}`).hex.toUpperCase();
      const ending = tokenHex.slice(-4);
      if (!map.has(ending)) map.set(ending, []);
      map.get(ending).push(lastByte);
    }
    endingMapCache = map;
    return map;
  }
  function requestedTokenEndings(raw) {
    const desired = String(raw || "").trim().toUpperCase();
    if (!desired) return ALLOWED_TOKEN_ENDINGS;
    if (!/^[0-9A-F]{4}$/.test(desired)) {
      throw new Error("Digite exatamente 4 caracteres hexadecimais (0-9 ou A-F), ou deixe em branco.");
    }
    if (!supportedEndingMap().has(desired)) {
      throw new Error(`Final ${desired} não pode ser gerado pelo core.js que está carregado neste site. Escolha um destes: ${Array.from(supportedEndingMap().keys()).sort().join(", ")}.`);
    }
    return [desired];
  }
  function matchesEndings(config, endings) {
    return endings.includes(tokenEnding(config.files?.[".config"]));
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
  function storeConfigRecord(config, desiredEndings) {
    if (!matchesEndings(config, desiredEndings)) throw new Error("A key não corresponde ao final solicitado. Nada foi salvo.");
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
  function randomUniqueMacFiltered(history, desiredEndings) {
    const map = supportedEndingMap();
    const matchingBytes = desiredEndings.flatMap(ending => map.get(ending) || []);
    if (!matchingBytes.length) throw new Error("Nenhum MAC pode produzir o final solicitado.");
    const byteHex = number => number.toString(16).padStart(2, "0").toUpperCase();
    // Os dois bytes intermediários variam para aumentar as combinações disponíveis.
    for (let attempt = 0; attempt < 2000; attempt++) {
      const fourth = byteHex(secureIndex(256));
      const fifth = byteHex(secureIndex(256));
      const last = matchingBytes[secureIndex(matchingBytes.length)];
      const mac = `${MAC_OUI_PREFIX}${fourth}:${fifth}:${last}`;
      if (!history.macs.has(mac)) return mac;
    }
    throw new Error("Não foi encontrado um MAC novo com esse final após várias tentativas.");
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
              <div class="field" style="margin:12px 0">
                <label for="single-token-ending">Escolher os 4 caracteres finais da key (opcional)</label>
                <input id="single-token-ending" maxlength="4" placeholder="Ex.: 4134 (vazio = automático)" list="token-ending-suggestions" spellcheck="false" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase">
                <datalist id="token-ending-suggestions"></datalist>
                <p class="field-hint" data-ending-hint>Carregando finais permitidos...</p>
              </div>
              <div class="button-row"><button class="button button-primary" data-action="generate-config">Gerar config</button></div>
              <p class="field-hint">O final escolhido é verificado antes de salvar. Cada novo MAC e Device ID é único no histórico deste navegador, mas o token completo pode se repetir.</p>
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
      // Gera as sugestões usando o core.js realmente carregado no navegador.
      // Não apresenta finais inventados nem depende de uma lista desatualizada.
      const availableEndings = [...supportedEndingMap().keys()].sort();
      q(this, "#token-ending-suggestions").innerHTML = availableEndings
        .map(ending => `<option value="${ending}"></option>`).join("");
      q(this, "[data-ending-hint]").textContent =
        `Deixe vazio para gerar entre ${ALLOWED_TOKEN_ENDINGS.join(", ")}. ` +
        `Finais que este core.js realmente produz: ${availableEndings.join(", ")}. ` +
        `Outros finais não podem ser gerados com este algoritmo.`;

      this.addEventListener("click", event => this.onClick(event));
      this.addEventListener("input", event => {
        if (event.target.matches("input")) {
          this.acceptedConfig = null;
          this.acceptedEndings = null;
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
          const desiredEndings = requestedTokenEndings(q(this, "#single-token-ending").value);
          const history = loadHistory();
          const mac = randomUniqueMacFiltered(history, desiredEndings);
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
            if (!matchesEndings(config, desiredEndings)) throw new Error("Final da key diferente do solicitado. Configuração não salva.");
            storeConfigRecord(config, desiredEndings);
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
          this.acceptedEndings = desiredEndings;
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
      if (!this.acceptedConfig || !matchesEndings(this.acceptedConfig, this.acceptedEndings || [])) throw new Error("Clique em Gerar config para criar uma key com o final solicitado.");
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
              <option value="all">Todas as keys</option>
              <option value="allowed">Somente os 5 finais padrão</option>
              <!-- Opções reais são adicionadas abaixo após ler ConfigCore.encodeSnToken -->
            </select>
          </div>
          <div class="button-row" style="margin:12px 0;display:flex;flex-wrap:wrap;gap:10px">
            <button class="button button-primary" type="button" data-history-zip>Baixar ZIP das keys filtradas</button>
            <button class="button button-outline" type="button" data-history-clear>Excluir histórico das keys</button>
          </div>
          <p class="field-hint">O ZIP incluirá somente os arquivos .config exibidos pelos filtros de final e pesquisa acima, sem apagar o histórico.</p>
          <p data-history-count></p><div data-history-results></div>
        </section>`;
      // Exibe todos os finais reconhecidos pelo core.js. Também inclui finais
      // que já existem nos registros, caso tenham vindo de uma versão anterior.
      const endingValues = new Set(supportedEndingMap().keys());
      try {
        readConfigRecords().forEach(record => {
          const ending = tokenEnding(record.content || "");
          if (/^[0-9A-F]{4}$/.test(ending)) endingValues.add(ending);
        });
      } catch (_) { /* histórico inválido será informado no render() */ }
      const endingSelect = q(this, "#history-ending");
      for (const ending of [...endingValues].sort()) {
        const option = document.createElement("option");
        option.value = ending;
        option.textContent = `Final ${ending}`;
        endingSelect.append(option);
      }
      q(this, "#history-search").addEventListener("input", () => this.render());
      endingSelect.addEventListener("change", () => this.render());
      this.addEventListener("click", event => {
        if (event.target.closest("[data-history-zip]")) {
          this.downloadFilteredZip();
          return;
        }
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
    filteredRecords(records) {
      // Mesma filtragem aplicada à lista visível e ao ZIP.
      const search = q(this, "#history-search").value.trim().toLowerCase();
      const selectedEnding = q(this, "#history-ending").value;
      return records.filter(record => {
        const token = String(extractConfigKeys(record.content || "").key_sn_token_unitvfree || "").trim().toUpperCase();
        const ending = token.slice(-4);
        const allowed = selectedEnding === "all" ||
          (selectedEnding === "allowed" ? ALLOWED_TOKEN_ENDINGS.includes(ending) : ending === selectedEnding);
        return allowed && [record.mac, record.userId, record.deviceId, ...Object.values(record.keys || {}), token]
          .some(value => String(value || "").toLowerCase().includes(search));
      });
    }
    downloadFilteredZip() {
      try {
        const records = readConfigRecords();
        const matches = this.filteredRecords(records).filter(record => typeof record.content === "string" && record.content.length > 0);
        if (!matches.length) {
          this.toast("Nenhuma key corresponde aos filtros. Ajuste o filtro ou a pesquisa antes de baixar.", "error");
          return;
        }
        // Mantém a numeração original do histórico mesmo quando apenas parte dele é exportada.
        const positions = new Map(records.map((record, index) => [record, index + 1]));
        const entries = matches.map(record => ({
          name: `KEYS_FILTRADAS/${configFilenameFor(record.content, positions.get(record))}`,
          content: record.content
        }));
        const selectedEnding = q(this, "#history-ending").value;
        const label = selectedEnding === "all" ? "TODAS" : selectedEnding === "allowed" ? "5_FINAIS" : selectedEnding;
        const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
        const filename = `KEYS_FILTRADAS_${label}_${stamp}.zip`;
        downloadBlob(ConfigCore.createZip(entries), filename);
        this.toast(`ZIP de ${entries.length} arquivo(s) .config enviado para download.`);
      } catch (error) {
        this.toast(`Falha ao preparar ZIP: ${error.message}`, "error");
      }
    }
    render() {
      let records;
      try { records = readConfigRecords(); }
      catch (error) { q(this, "[data-history-count]").textContent = error.message; return; }
      const matches = this.filteredRecords(records);
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
          <article class="apk-item"><div><span class="apk-type">Versão clássica</span><h3>UniTV Free 5.7.2</h3></div><p>Versão anterior mantida para compatibilidade com dispositivos.</p><a class="button button-primary" href="https://github.com/nilsonbastos/unitv-config/releases/download/V5.7.2/uvFree_5.7.2.apk" download>Baixar APK</a></article>
          <article class="apk-item"><div><span class="apk-type">Versão legada</span><h3>UniTV Free 5.4.1</h3></div><p>Pacote antigo disponível no diretório de aplicativos.</p><a class="button button-primary" href="https://github.com/nilsonbastos/unitv-config/releases/download/v5.4.1/UniTV.Free.5.4.1.apk" download>Baixar APK</a></article>
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

