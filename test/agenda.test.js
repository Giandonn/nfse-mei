// Agendamento: os arquivos gerados para o Windows (VBS + XML da tarefa) e para o macOS (plist).
// A tarefa de verdade só é criada no CI do Windows (NFSE_MEI_TESTAR_AGENDA=1), com nome e pasta de teste.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const agenda = require('../src/agenda');

test('VBS roda o node escondido, com aspas certas mesmo com espaço no caminho', () => {
  const vbs = agenda.conteudoVbs('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Fulano de Tal\\nfse-mei\\bin\\nfse-mei.js');
  assert.match(vbs, /sh\.Run """C:\\Program Files\\nodejs\\node\.exe"" ""C:\\Users\\Fulano de Tal\\nfse-mei\\bin\\nfse-mei\.js"" rotina", 0, False/);
});

test('XML da tarefa: diária com repetição, ao entrar, roda o que perdeu, sem admin', () => {
  const xml = agenda.xmlTarefaWindows('C:\\x\\rotina.vbs', 'PC\\fulano');
  for (const trecho of ['<Interval>PT2H</Interval>', '<LogonTrigger>', '<StartWhenAvailable>true</StartWhenAvailable>',
    '<RunLevel>LeastPrivilege</RunLevel>', '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '<Command>wscript.exe</Command>', '"C:\\x\\rotina.vbs"', '<UserId>PC\\fulano</UserId>']) {
    assert.ok(xml.includes(trecho), trecho);
  }
  assert.ok(agenda.xmlTarefaWindows('C:\\a&b\\r.vbs', 'PC\\x').includes('C:\\a&amp;b\\r.vbs'), 'escapa & no XML');
});

test('plist do macOS: 9h a 21h, ao entrar, log na pasta do config', () => {
  const plist = agenda.plistMac('/usr/local/bin/node', '/opt/nfse-mei/bin/nfse-mei.js');
  assert.match(plist, /<string>\/usr\/local\/bin\/node<\/string>\s*<string>\/opt\/nfse-mei\/bin\/nfse-mei\.js<\/string>\s*<string>rotina<\/string>/);
  assert.strictEqual((plist.match(/<key>Hour<\/key>/g) || []).length, 7);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  if (process.platform === 'darwin') {
    const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plist-')), 't.plist');
    fs.writeFileSync(arq, plist);
    execFileSync('plutil', ['-lint', arq]); // o próprio macOS valida o formato
  }
});

const testarDeVerdade = process.platform === 'win32' && process.env.NFSE_MEI_TESTAR_AGENDA === '1';
test('Windows: cria a tarefa de verdade, ela roda a rotina e some ao remover', { skip: !testarDeVerdade && 'só no Windows do CI' }, () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nfse-mei-agenda-'));
  const env = { ...process.env, NFSE_MEI_CONFIG: path.join(pasta, 'config.json'), NFSE_MEI_TAREFA: 'nfse-mei-teste-ci' };
  const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'nfse-mei.js'), ...a], { env, encoding: 'utf8' });
  fs.writeFileSync(env.NFSE_MEI_CONFIG, JSON.stringify({
    prestadorCnpj: '11222333000181', pastaNotas: pasta,
    servico: { municipio: 'X', codigoTributacaoNacional: '01.01.01', nbs: '115022000', descricao: 'Y' }, tomadores: {}, automacao: { das: false },
  }));
  try {
    let r = cli('agendar');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(execFileSync('schtasks', ['/Query', '/TN', 'nfse-mei-teste-ci'], { encoding: 'utf8' }), /nfse-mei-teste-ci/);
    r = cli('agendar', 'status');
    assert.match(r.stdout, /Rotina ligada/);
    // Dispara agora e espera a rotina escrever no log.
    execFileSync('schtasks', ['/Run', '/TN', 'nfse-mei-teste-ci']);
    const log = path.join(pasta, 'rotina.log');
    const fim = Date.now() + 60000;
    while (Date.now() < fim && !(fs.existsSync(log) && /fim:/.test(fs.readFileSync(log, 'utf8')))) execFileSync('powershell', ['-c', 'Start-Sleep 1']);
    assert.match(fs.readFileSync(log, 'utf8'), /fim: nada a fazer/);
  } finally {
    const r = cli('agendar', 'remover');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.throws(() => execFileSync('schtasks', ['/Query', '/TN', 'nfse-mei-teste-ci'], { stdio: 'pipe' }));
  }
});

test('config fora do padrão vai junto para a tarefa (ela não herda o ambiente)', () => {
  const vbs = agenda.conteudoVbs('node.exe', 'x.js', [['NFSE_MEI_CONFIG', 'D:/meu "mei"/config.json']]);
  assert.ok(vbs.includes('sh.Environment("Process")("NFSE_MEI_CONFIG") = "D:/meu ""mei""/config.json"'), vbs);
  assert.ok(vbs.indexOf('Environment') < vbs.indexOf('sh.Run'), 'define antes de rodar');
  assert.match(agenda.plistMac('n', 's', [['NFSE_MEI_CONFIG', '/a&b/c.json']]), /<key>NFSE_MEI_CONFIG<\/key><string>\/a&amp;b\/c\.json<\/string>/);
  assert.ok(!agenda.plistMac('n', 's', []).includes('EnvironmentVariables'));
});
