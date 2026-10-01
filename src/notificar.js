// Avisos e perguntas na tela, sem terminal: notificação do sistema (avisar) e janela com botões (perguntar).
// Windows: toast + janela do Windows Forms (PowerShell). macOS: notificação e diálogo nativos (osascript).
// Os textos vão por variável de ambiente, nunca colados no script, para nada no texto virar comando.
const fs = require('fs');
const { spawn } = require('child_process');

// Testes: NFSE_MEI_NOTIFICACOES=<arquivo> grava cada aviso/pergunta (uma linha JSON) em vez de mostrar,
// e NFSE_MEI_RESPOSTAS="Emitir agora,Depois" responde as perguntas na ordem.
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
  $b.Tag = $rotulo
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

// JXA (JavaScript for Automation) lendo os textos das variáveis de ambiente.
const JXA_ENV = "ObjC.import('stdlib'); const app = Application.currentApplication(); app.includeStandardAdditions = true; const env = k => $.getenv(k);";
const NOTIF_MAC = `${JXA_ENV} app.displayNotification(env('NFSE_TEXTO'), { withTitle: env('NFSE_TITULO') });`;
const DIALOGO_MAC = `${JXA_ENV}
const botoes = env('NFSE_BOTOES').split('|').slice(0, 3).reverse();
try {
  const r = app.displayDialog(env('NFSE_TEXTO'), { withTitle: env('NFSE_TITULO'), buttons: botoes, defaultButton: botoes[botoes.length - 1], givingUpAfter: Number(env('NFSE_SEGUNDOS')) });
  r.gaveUp ? '' : r.buttonReturned;
} catch (e) { ''; }`;

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
  if (process.platform === 'win32') r = await rodar('powershell', [...PS, DIALOGO_WINDOWS], env, espera);
  else if (process.platform === 'darwin') r = await rodar('osascript', ['-l', 'JavaScript', '-e', DIALOGO_MAC], env, espera);
  return r && botoes.includes(r) ? r : null;
}

module.exports = { avisar, perguntar };
