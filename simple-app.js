
$ErrorActionPreference = "Stop"

$arquivo = "F:\unitv free arquivos\UniTVConfigAndroid\UniTVConfigAndroid\SIMPLE ATUAL\simple-app.js"

if (!(Test-Path -LiteralPath $arquivo)) {
    throw "Arquivo não encontrado: $arquivo"
}

# Ler o arquivo e preservar eventual BOM UTF-8
$bytes = [System.IO.File]::ReadAllBytes($arquivo)
$temBOM = $bytes.Length -ge 3 -and
    $bytes[0] -eq 0xEF -and
    $bytes[1] -eq 0xBB -and
    $bytes[2] -eq 0xBF

$utf8 = New-Object System.Text.UTF8Encoding($false)
$codigo = [System.IO.File]::ReadAllText($arquivo, [System.Text.Encoding]::UTF8)

# Backup antes de qualquer modificação
$backup = "$arquivo.bak_visualizar_config_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item -LiteralPath $arquivo -Destination $backup

$padrao = '(?s)        const detail = document\.createElement\("p"\);.*?        results\.appendChild\(card\);'

$novoTrecho = @'
        const detail = document.createElement("p");
        detail.style.marginBottom = "10px";
        detail.textContent = item.valid
          ? "Arquivo lido e validado."
          : "Erro: " + item.error;

        card.appendChild(detail);

        if (item.valid) {
          const details = document.createElement("details");
          details.style.marginTop = "10px";

          const summary = document.createElement("summary");
          summary.textContent = "Ver conteúdo completo do arquivo";
          summary.style.cursor = "pointer";
          summary.style.fontWeight = "bold";
          details.appendChild(summary);

          const cabecalho = document.createElement("p");
          cabecalho.textContent =
            "Arquivo: " + item.name +
            " | Cabeçalho, data e demais dados abaixo:";
          cabecalho.style.marginTop = "10px";
          details.appendChild(cabecalho);

          const conteudo = document.createElement("pre");
          conteudo.textContent = item.content;
          conteudo.style.cssText =
            "white-space:pre-wrap;overflow-wrap:anywhere;" +
            "word-break:break-word;padding:12px;" +
            "border:1px solid #888;border-radius:6px;" +
            "max-height:400px;overflow:auto;font-size:12px;" +
            "user-select:text";

          details.appendChild(conteudo);

          const copiar = document.createElement("button");
          copiar.type = "button";
          copiar.className = "button button-outline";
          copiar.textContent = "Copiar conteúdo completo";
          copiar.style.marginTop = "8px";

          copiar.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(item.content);
              copiar.textContent = "Conteúdo copiado!";
            } catch (error) {
              conteudo.focus();
              const selecao = document.createRange();
              selecao.selectNodeContents(conteudo);
              const selecionador = window.getSelection();
              selecionador.removeAllRanges();
              selecionador.addRange(selecao);
              copiar.textContent =
                "Selecione o texto e copie manualmente";
            }
          });

          details.appendChild(copiar);
          card.appendChild(details);
        }

        results.appendChild(card);
'@

$regex = [regex]::new($padrao)
$correspondencias = $regex.Matches($codigo)

if ($correspondencias.Count -ne 1) {
    throw "Esperava encontrar exatamente um trecho, mas encontrei $($correspondencias.Count). Nenhuma alteração foi gravada. Backup: $backup"
}

$alterado = $regex.Replace($codigo, $novoTrecho, 1)

if ($alterado -eq $codigo) {
    throw "O código não mudou. Arquivo original preservado."
}

# Gravar mantendo o padrão UTF-8 e eventual BOM
$codificacaoSaida = New-Object System.Text.UTF8Encoding($temBOM)
[System.IO.File]::WriteAllText($arquivo, $alterado, $codificacaoSaida)

# Conferir a gravação
$verificacao = [System.IO.File]::ReadAllText($arquivo, [System.Text.Encoding]::UTF8)

if (
    $verificacao.Contains("Ver conteúdo completo do arquivo") -and
    $verificacao.Contains("Copiar conteúdo completo") -and
    $verificacao.Contains("conteudo.textContent = item.content")
) {
    Write-Host "`nSUCESSO: visualização adicionada!" -ForegroundColor Green
    Write-Host "Arquivo alterado: $arquivo" -ForegroundColor Cyan
    Write-Host "Backup: $backup" -ForegroundColor Yellow
} else {
    Copy-Item -LiteralPath $backup -Destination $arquivo -Force
    throw "A verificação falhou. O backup foi restaurado."
}
