// Avisos e perguntas na tela, sem terminal: notificação do sistema (avisar) e janela com botões (perguntar).
// Windows: toast + janela do Windows Forms (PowerShell). macOS: notificação e diálogo nativos (osascript).
// Os textos vão por variável de ambiente, nunca colados no script, para nada no texto virar comando.
const fs = require('fs');
const { spawn } = require('child_process');

// Testes: NFSE_MEI_NOTIFICACOES=<arquivo> grava cada aviso/pergunta (uma linha JSON) em vez de mostrar,
// e NFSE_MEI_RESPOSTAS="Emitir agora,Depois" responde as perguntas na ordem. Na janela da nota, a resposta
// pode trazer o valor e se é para guardar: "Emitir=3800=guardar" (valor sem vírgula).
function gravarTeste(evento) {
  fs.appendFileSync(process.env.NFSE_MEI_NOTIFICACOES, JSON.stringify(evento) + '\n');
  if (evento.tipo !== 'pergunta') return null;
  const respostas = (process.env.NFSE_MEI_RESPOSTAS || '').split(',').filter(Boolean);
  const usadas = fs.readFileSync(process.env.NFSE_MEI_NOTIFICACOES, 'utf8').split('\n').filter(l => l.includes('"tipo":"pergunta"')).length;
  return respostas[usadas - 1] || null;
}

function rodar(cmd, args, env, timeoutMs) {
  return new Promise(resolve => {
    let saida = '';
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    const relogio = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', d => { saida += d; });
    p.on('error', () => { clearTimeout(relogio); resolve(null); });
    p.on('close', codigo => { clearTimeout(relogio); resolve(codigo === 0 ? saida.trim() : null); });
  });
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

const TOAST_WINDOWS = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$t = [Security.SecurityElement]::Escape($env:NFSE_TITULO)
$m = [Security.SecurityElement]::Escape($env:NFSE_TEXTO)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$m</text></binding></visual></toast>")
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
`;

const DIALOGO_WINDOWS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object Windows.Forms.Form
$f.Text = $env:NFSE_TITULO
$f.TopMost = $true
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false
$f.MinimizeBox = $false
$f.AutoSize = $true
$f.AutoSizeMode = 'GrowAndShrink'
$f.Padding = New-Object Windows.Forms.Padding(16)
$f.Font = New-Object Drawing.Font('Segoe UI', 10)
$painel = New-Object Windows.Forms.FlowLayoutPanel
$painel.FlowDirection = 'TopDown'
$painel.AutoSize = $true
$painel.Padding = New-Object Windows.Forms.Padding(18, 14, 18, 10)
$texto = New-Object Windows.Forms.Label
$texto.Text = $env:NFSE_TEXTO
$texto.AutoSize = $true
$texto.MaximumSize = New-Object Drawing.Size(480, 0)
$texto.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$painel.Controls.Add($texto)
$botoes = New-Object Windows.Forms.FlowLayoutPanel
$botoes.AutoSize = $true
$script:escolha = ''
$i = 0
foreach ($rotulo in $env:NFSE_BOTOES.Split('|')) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $rotulo
  $b.AutoSize = $true
  $b.Padding = New-Object Windows.Forms.Padding(8, 4, 8, 4)
  $b.Tag = [string]$i
  $b.Add_Click({ $script:escolha = $this.Tag; $f.Close() })
  $botoes.Controls.Add($b)
  if ($i -eq 0) { $f.AcceptButton = $b }
  $i++
}
$painel.Controls.Add($botoes)
$f.Controls.Add($painel)
$relogio = New-Object Windows.Forms.Timer
$relogio.Interval = [int]$env:NFSE_SEGUNDOS * 1000
$relogio.Add_Tick({ $relogio.Stop(); $f.Close() })
$relogio.Start()
$f.Add_Shown({ $f.Activate() })
# O Node abre o PowerShell escondido, e o Windows aplica isso ao primeiro ShowWindow do processo.
# Gasta esse primeiro ShowWindow numa chamada descartável; a janela de verdade aparece no ShowDialog.
Add-Type -Namespace NfseMei -Name Janela -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
[void][NfseMei.Janela]::ShowWindow($f.Handle, 0)
[void]$f.ShowDialog()
[Console]::Out.Write($script:escolha)
`;

// Janela da nota do mês: valor já preenchido e editável, o botão de emitir mostra o valor que vai sair.
// Devolve uma linha "posição do botão|valor digitado|1 se é para guardar o valor" (só ASCII, por causa da
// codificação do console do PowerShell).
const NOTA_WINDOWS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$br = [Globalization.CultureInfo]::GetCultureInfo('pt-BR')
function Ler-Valor([string]$s) {
  $s = $s.Trim() -replace '^R\\$\\s*', ''
  if ($s -notmatch '^\\d{1,3}(\\.\\d{3})*(,\\d{1,2})?$' -and $s -notmatch '^\\d+([.,]\\d{1,2})?$') { return $null }
  $milhar = $s -match '^\\d{1,3}(\\.\\d{3})+$'
  $n = if ($s.Contains(',') -or $milhar) { $s.Replace('.', '').Replace(',', '.') } else { $s }
  $v = [decimal]::Parse($n, [Globalization.CultureInfo]::InvariantCulture)
  if ($v -le 0) { return $null }
  return $v
}
$f = New-Object Windows.Forms.Form
$f.Text = $env:NFSE_TITULO
$f.TopMost = $true
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false
$f.MinimizeBox = $false
$f.AutoSize = $true
$f.AutoSizeMode = 'GrowAndShrink'
$f.Font = New-Object Drawing.Font('Segoe UI', 10)
$painel = New-Object Windows.Forms.FlowLayoutPanel
$painel.FlowDirection = 'TopDown'
$painel.AutoSize = $true
$painel.Padding = New-Object Windows.Forms.Padding(20, 16, 20, 12)
function Rotulo([string]$texto, $fonte, $cor, [int]$depois) {
  $l = New-Object Windows.Forms.Label
  $l.Text = $texto
  $l.AutoSize = $true
  $l.MaximumSize = New-Object Drawing.Size(460, 0)
  if ($fonte) { $l.Font = $fonte }
  if ($cor) { $l.ForeColor = $cor }
  $l.Margin = New-Object Windows.Forms.Padding(0, 0, 0, $depois)
  $painel.Controls.Add($l)
}
Rotulo $env:NFSE_CLIENTE (New-Object Drawing.Font('Segoe UI Semibold', 12)) $null 2
Rotulo "Competência: $env:NFSE_COMPETENCIA" $null ([Drawing.Color]::DimGray) 14
$linha = New-Object Windows.Forms.FlowLayoutPanel
$linha.AutoSize = $true
$linha.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 4)
$rs = New-Object Windows.Forms.Label
$rs.Text = 'Valor:  R$'
$rs.AutoSize = $true
$rs.Margin = New-Object Windows.Forms.Padding(0, 6, 6, 0)
$caixa = New-Object Windows.Forms.TextBox
$caixa.Text = $env:NFSE_VALOR
$caixa.Width = 150
$caixa.Font = New-Object Drawing.Font('Segoe UI', 12)
$linha.Controls.Add($rs)
$linha.Controls.Add($caixa)
$painel.Controls.Add($linha)
$guardar = New-Object Windows.Forms.CheckBox
$guardar.Text = 'Usar este valor nos próximos meses'
$guardar.AutoSize = $true
$guardar.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 12)
$guardar.Visible = $env:NFSE_VALOR -ne ''
$guardar.Enabled = $false
$painel.Controls.Add($guardar)
if ($env:NFSE_RESUMO) { Rotulo $env:NFSE_RESUMO $null ([Drawing.Color]::DimGray) 10 }
if ($env:NFSE_ALERTA) { Rotulo $env:NFSE_ALERTA $null ([Drawing.Color]::FromArgb(160, 30, 30)) 10 }
$botoes = New-Object Windows.Forms.FlowLayoutPanel
$botoes.AutoSize = $true
$botoes.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 0)
$script:escolha = ''
$rotulos = $env:NFSE_BOTOES.Split('|')
for ($i = 0; $i -lt $rotulos.Length; $i++) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $rotulos[$i]
  $b.AutoSize = $true
  $b.Padding = New-Object Windows.Forms.Padding(8, 4, 8, 4)
  $b.Tag = [string]$i
  $b.Add_Click({ $script:escolha = $this.Tag; $f.Close() })
  $botoes.Controls.Add($b)
  if ($i -eq 0) { $emitir = $b; $f.AcceptButton = $b }
}
$painel.Controls.Add($botoes)
$f.Controls.Add($painel)
$atualizar = {
  $v = Ler-Valor $caixa.Text
  $emitir.Enabled = $null -ne $v
  $emitir.Text = if ($null -ne $v) { 'Emitir R$ ' + $v.ToString('N2', $br) } else { 'Emitir' }
  $guardar.Enabled = ($null -ne $v) -and ($caixa.Text.Trim() -ne $env:NFSE_VALOR)
  if (-not $guardar.Enabled) { $guardar.Checked = $false }
}
$caixa.Add_TextChanged($atualizar)
& $atualizar
$relogio = New-Object Windows.Forms.Timer
$relogio.Interval = [int]$env:NFSE_SEGUNDOS * 1000
$relogio.Add_Tick({ $relogio.Stop(); $f.Close() })
$relogio.Start()
$f.Add_Shown({ $f.Activate(); $caixa.Focus(); $caixa.SelectAll() })
Add-Type -Namespace NfseMei -Name Janela -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
[void][NfseMei.Janela]::ShowWindow($f.Handle, 0)
[void]$f.ShowDialog()
$sim = if ($guardar.Checked) { '1' } else { '0' }
[Console]::Out.Write("$script:escolha|$($caixa.Text.Trim())|$sim")
`;

// JXA (JavaScript for Automation) lendo os textos das variáveis de ambiente.
const JXA_ENV = "ObjC.import('stdlib'); const app = Application.currentApplication(); app.includeStandardAdditions = true; const env = k => $.getenv(k);";
const NOTIF_MAC = `${JXA_ENV} app.displayNotification(env('NFSE_TEXTO'), { withTitle: env('NFSE_TITULO') });`;
const DIALOGO_MAC = `${JXA_ENV}
const botoes = env('NFSE_BOTOES').split('|').slice(0, 3).reverse();
try {
  const r = app.displayDialog(env('NFSE_TEXTO'), { withTitle: env('NFSE_TITULO'), buttons: botoes, defaultButton: botoes[botoes.length - 1], givingUpAfter: Number(env('NFSE_SEGUNDOS')) });
  r.gaveUp ? '' : r.buttonReturned;
} catch (e) { ''; }`;

const NOTA_MAC = `${JXA_ENV}
const botoes = env('NFSE_BOTOES').split('|');
const texto = [env('NFSE_CLIENTE'), 'Competência: ' + env('NFSE_COMPETENCIA'), env('NFSE_RESUMO'), env('NFSE_ALERTA'), '', 'Valor (R$):'].filter((l, i) => l || i > 3).join('\\n');
try {
  const r = app.displayDialog(texto, { withTitle: env('NFSE_TITULO'), defaultAnswer: env('NFSE_VALOR'), buttons: botoes.slice().reverse(), defaultButton: botoes[0], givingUpAfter: Number(env('NFSE_SEGUNDOS')) });
  let guardar = '0';
  const valor = r.textReturned.trim();
  if (!r.gaveUp && r.buttonReturned === botoes[0] && env('NFSE_VALOR') && valor !== env('NFSE_VALOR')) {
    try { guardar = app.displayDialog('Usar R$ ' + valor + ' nos próximos meses?', { withTitle: env('NFSE_TITULO'), buttons: ['Só este mês', 'Usar sempre'], defaultButton: 'Só este mês' }).buttonReturned === 'Usar sempre' ? '1' : '0'; } catch (e) { }
  }
  r.gaveUp ? '' : botoes.indexOf(r.buttonReturned) + '|' + valor + '|' + guardar;
} catch (e) { ''; }`;

function botaoPelaPosicao(botoes, saida) {
  return /^\d+$/.test(saida || '') ? botoes[Number(saida)] ?? null : null;
}

// Mostra um aviso que some sozinho. Nunca falha: sem jeito de mostrar, só não mostra.
async function avisar(titulo, texto) {
  if (process.env.NFSE_MEI_NOTIFICACOES) return gravarTeste({ tipo: 'aviso', titulo, texto });
  const env = { NFSE_TITULO: titulo, NFSE_TEXTO: texto };
  if (process.platform === 'win32') return rodar('powershell', [...PS, TOAST_WINDOWS], env, 30000);
  if (process.platform === 'darwin') return rodar('osascript', ['-l', 'JavaScript', '-e', NOTIF_MAC], env, 30000);
  return rodar('notify-send', [titulo, texto], {}, 10000);
}

// Janela com botões. Devolve o rótulo clicado, ou null se fechou/esgotou o tempo/não dá para mostrar.
// O primeiro botão é o principal. No macOS cabem até 3 botões.
async function perguntar(titulo, texto, botoes, { segundos = Number(process.env.NFSE_MEI_JANELA_SEGUNDOS) || 15 * 60 } = {}) {
  if (process.env.NFSE_MEI_NOTIFICACOES) return gravarTeste({ tipo: 'pergunta', titulo, texto, botoes });
  const env = { NFSE_TITULO: titulo, NFSE_TEXTO: texto, NFSE_BOTOES: botoes.join('|'), NFSE_SEGUNDOS: String(segundos) };
  const espera = (segundos + 30) * 1000;
  let r = null;
  if (process.platform === 'win32') r = botaoPelaPosicao(botoes, await rodar('powershell', [...PS, DIALOGO_WINDOWS], env, espera));
  else if (process.platform === 'darwin') r = await rodar('osascript', ['-l', 'JavaScript', '-e', DIALOGO_MAC], env, espera);
  return r && botoes.includes(r) ? r : null;
}

// Janela da nota do mês com o valor editável. botoes[0] é o de emitir.
// Devolve { botao, valor, guardar } ou null se fechou/esgotou o tempo/não dá para mostrar.
async function pedirNota({ titulo, cliente, competencia, valor = '', resumo = '', alerta = '', botoes }, { segundos = Number(process.env.NFSE_MEI_JANELA_SEGUNDOS) || 15 * 60 } = {}) {
  if (process.env.NFSE_MEI_NOTIFICACOES) {
    const r = gravarTeste({ tipo: 'pergunta', titulo, texto: `${cliente} · ${competencia} · R$ ${valor}`, botoes });
    const [botao, digitado, guardar] = (r || '').split('=');
    return botoes.includes(botao) ? { botao, valor: digitado ?? valor, guardar: guardar === 'guardar' } : null;
  }
  const env = {
    NFSE_TITULO: titulo, NFSE_CLIENTE: cliente, NFSE_COMPETENCIA: competencia, NFSE_VALOR: valor,
    NFSE_RESUMO: resumo, NFSE_ALERTA: alerta, NFSE_BOTOES: botoes.join('|'), NFSE_SEGUNDOS: String(segundos),
  };
  const espera = (segundos + 30) * 1000;
  let saida = null;
  if (process.platform === 'win32') saida = await rodar('powershell', [...PS, NOTA_WINDOWS], env, espera);
  else if (process.platform === 'darwin') saida = await rodar('osascript', ['-l', 'JavaScript', '-e', NOTA_MAC], env, espera);
  const m = /^(\d+)\|(.*)\|([01])$/.exec(saida || '');
  const botao = m && botaoPelaPosicao(botoes, m[1]);
  return botao ? { botao, valor: m[2].trim(), guardar: m[3] === '1' } : null;
}

module.exports = { avisar, perguntar, pedirNota };
