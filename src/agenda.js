// Liga/desliga a rotina automática (`nfse-mei rotina`) no agendador do sistema, sem precisar de administrador.
// Windows: tarefa "nfse-mei" no Agendador (todo dia às 9h, repetindo a cada 2h até 21h, ao entrar no
//          Windows e assim que possível se o PC estava desligado). Roda escondida via wscript.
// macOS:   LaunchAgent (9h, 11h, ..., 21h e ao entrar; o launchd roda o que perdeu quando o Mac acorda).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ARQUIVO_CONFIG } = require('./config');

const PASTA = path.dirname(ARQUIVO_CONFIG);
const NOME_TAREFA = process.env.NFSE_MEI_TAREFA || 'nfse-mei';
const ROTULO_MAC = 'io.github.giandonn.nfse-mei';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${ROTULO_MAC}.plist`);
const SCRIPT = path.resolve(__dirname, '..', 'bin', 'nfse-mei.js');
const LOG = path.join(PASTA, 'rotina.log');

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

// A tarefa agendada não herda o ambiente de quem agendou: config/perfil fora do padrão vão junto.
const VARIAVEIS = ['NFSE_MEI_CONFIG', 'NFSE_MEI_PERFIL'];
const variaveisParaLevar = () => VARIAVEIS.filter(v => process.env[v]).map(v => [v, process.env[v]]);

// O .vbs roda o node sem abrir janela de terminal. As aspas são dobradas no VBScript.
function conteudoVbs(node = process.execPath, script = SCRIPT, variaveis = variaveisParaLevar()) {
  const q = s => `""${s.replace(/"/g, '""')}""`;
  return [
    "' nfse-mei: roda a rotina sem abrir janela (criado por `nfse-mei agendar`).",
    'Set sh = CreateObject("WScript.Shell")',
    ...variaveis.map(([k, v]) => `sh.Environment("Process")("${k}") = "${v.replace(/"/g, '""')}"`),
    `sh.Run "${q(node)} ${q(script)} rotina", 0, False`,
    '',
  ].join('\r\n');
}

function xmlTarefaWindows(vbs, usuario = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>nfse-mei: nota fiscal do mês, lembrete do DAS e limite do MEI. Desligar: nfse-mei agendar remover</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T09:00:00</StartBoundary>
      <Repetition><Interval>PT2H</Interval><Duration>PT12H</Duration></Repetition>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
    <LogonTrigger>
      <UserId>${xmlEsc(usuario)}</UserId>
      <Delay>PT3M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xmlEsc(usuario)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <ExecutionTimeLimit>PT1H</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>//B //Nologo "${xmlEsc(vbs)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function plistMac(node = process.execPath, script = SCRIPT, variaveis = variaveisParaLevar()) {
  const horas = [9, 11, 13, 15, 17, 19, 21].map(h => `      <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>0</integer></dict>`).join('\n');
  const env = variaveis.length
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${variaveis.map(([k, v]) => `    <key>${k}</key><string>${xmlEsc(v)}</string>`).join('\n')}\n  </dict>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ROTULO_MAC}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEsc(node)}</string>
    <string>${xmlEsc(script)}</string>
    <string>rotina</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${horas}
  </array>
  <key>RunAtLoad</key><true/>
${env}  <key>StandardOutPath</key><string>${xmlEsc(LOG)}</string>
  <key>StandardErrorPath</key><string>${xmlEsc(LOG)}</string>
</dict>
</plist>
`;
}

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

function ligar() {
  fs.mkdirSync(PASTA, { recursive: true });
  if (process.platform === 'win32') {
    const vbs = path.join(PASTA, 'rotina.vbs');
    fs.writeFileSync(vbs, conteudoVbs());
    const xml = path.join(PASTA, 'tarefa.xml');
    fs.writeFileSync(xml, '﻿' + xmlTarefaWindows(vbs), 'utf16le'); // o schtasks exige UTF-16
    try { run('schtasks', ['/Create', '/F', '/TN', NOME_TAREFA, '/XML', xml]); } finally { fs.rmSync(xml, { force: true }); }
    return `Tarefa "${NOME_TAREFA}" criada no Agendador de Tarefas do Windows.`;
  }
  if (process.platform === 'darwin') {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    fs.writeFileSync(PLIST, plistMac());
    const dominio = `gui/${process.getuid()}`;
    try { run('launchctl', ['bootout', dominio, PLIST]); } catch { /* não estava carregado */ }
    run('launchctl', ['bootstrap', dominio, PLIST]);
    return `LaunchAgent criado em ${PLIST}.`;
  }
  throw new Error(`No Linux, agende você mesmo (crontab -e):\n0 9-21/2 * * * "${process.execPath}" "${SCRIPT}" rotina >> "${LOG}" 2>&1`);
}

function desligar() {
  if (process.platform === 'win32') {
    try { run('schtasks', ['/Delete', '/F', '/TN', NOME_TAREFA]); } catch (e) { if (!/não pode|cannot find|não foi poss|does not exist/i.test(e.stderr || e.message)) throw e; }
    fs.rmSync(path.join(PASTA, 'rotina.vbs'), { force: true });
    return 'Rotina automática desligada.';
  }
  if (process.platform === 'darwin') {
    try { run('launchctl', ['bootout', `gui/${process.getuid()}`, PLIST]); } catch { /* já estava fora */ }
    fs.rmSync(PLIST, { force: true });
    return 'Rotina automática desligada.';
  }
  return 'No Linux, remova a linha do nfse-mei do seu crontab (crontab -e).';
}

// { ligada, proxima, detalhe }
function situacao() {
  try {
    if (process.platform === 'win32') {
      const out = run('schtasks', ['/Query', '/TN', NOME_TAREFA, '/FO', 'LIST', '/V']);
      const proxima = /(Próxima Execução|Next Run Time):\s*(.+)/i.exec(out)?.[2]?.trim();
      const vbs = path.join(PASTA, 'rotina.vbs');
      const aponta = fs.existsSync(vbs) && fs.readFileSync(vbs, 'utf8').includes(SCRIPT) && fs.existsSync(process.execPath);
      return { ligada: true, proxima, detalhe: aponta ? null : 'a tarefa aponta para outra instalação; rode nfse-mei agendar de novo' };
    }
    if (process.platform === 'darwin') {
      if (!fs.existsSync(PLIST)) return { ligada: false };
      const aponta = fs.readFileSync(PLIST, 'utf8').includes(SCRIPT);
      return { ligada: true, detalhe: aponta ? null : 'o LaunchAgent aponta para outra instalação; rode nfse-mei agendar de novo' };
    }
  } catch { /* tarefa não existe */ }
  return { ligada: false };
}

module.exports = { ligar, desligar, situacao, conteudoVbs, xmlTarefaWindows, plistMac, NOME_TAREFA, LOG, SCRIPT, PLIST };
