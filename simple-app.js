
(function () {
  const q = (root, selector) => root.querySelector(selector);

  const qa = (root, selector) =>
    Array.from(root.querySelectorAll(selector));

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
        const suffix = Math.floor(Math.random() * 256).toString(16).padStart(2, "0").toUpperCase();
        q(this, "#single-mac").value = `9C:00:D3:EC:AA:${suffix}`;
        q(this, "#single-user").value = ConfigCore.randomUserId();
        q(this, "#single-folder").value = `CONFIG_${Date.now().toString().slice(-6)}`;
        q(this, "#single-device").value = "";
        this.generate();
        this.toast("Nova config gerada.");
      }
      if (action === "copy") this.copyCurrent();
      if (action === "download-current") this.downloadCurrent();
      if (action === "download-config") this.downloadConfig();
      if (action === "download-zip") this.downloadZip();
      if (action === "save-folder") this.saveFolder();
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
      downloadBlob(new Blob([this.files[this.currentFile] || ""], { type: "application/octet-stream" }), this.currentFile);
      this.toast(`${this.currentFile} baixado.`);
    }

    downloadConfig() {
      const config = this.generate();
      if (!config || !config.files[".config"]) return this.toast("Gere ou carregue um arquivo primeiro.", "error");
      downloadBlob(new Blob([config.files[".config"]], { type: "application/octet-stream" }), randomConfigFilename());
      this.toast("Arquivo .config baixado com a extensão correta.");
    }

    downloadZip() {
      const config = this.generate();
      if (!config) return;
      downloadBlob(ConfigCore.createZip(zipEntries(config)), `${config.folder_name}.zip`);
      this.toast("Pacote ZIP baixado.");
    }

    async saveFolder() {
      const config = this.generate();
      if (!config) return;
      try {
        const result = await saveConfig(config);
        if (result === "folder") this.toast(`Arquivos salvos na pasta ${config.folder_name}.`);
        if (result === "zip") this.toast("Este navegador não permite selecionar uma pasta aqui; baixei um ZIP com os arquivos.");
      } catch (error) {
        this.toast(`Falha ao salvar: ${error.message}`, "error");
      }
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
          </nav>
          <section class="view-panel" data-panel="generator"><single-generator-view></single-generator-view></section>
          <section class="view-panel" data-panel="apps" hidden><apps-view></apps-view></section>
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
      const apps = button.dataset.view === "apps";
      q(this, "[data-page-title]").textContent = apps ? "Aplicativos" : "Gerador individual";
      q(this, "[data-page-note]").textContent = apps
        ? "Baixe os pacotes disponíveis na pasta local de aplicativos."
        : "Gere, revise e salve arquivos diretamente no navegador. Os valores ficam no dispositivo.";
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
  customElements.define("studio-app", StudioApp);
})();
