; Instalador do nfse-mei para Windows (Inno Setup 6). Monte com: node instalador/montar-windows.js
; Instala só para o usuário (sem administrador), com o Node junto: não precisa ter nada instalado além do Chrome.
#define Versao GetEnv("NFSE_MEI_VERSAO")
#if Versao == ""
  #define Versao "0.0.0"
#endif

[Setup]
AppId={{6F1D3B52-8E4A-4C7B-9C55-2A7E0B9D41F3}
AppName=nfse-mei
AppVersion={#Versao}
AppVerName=nfse-mei {#Versao}
AppPublisher=Lucas Raineri
AppPublisherURL=https://github.com/Giandonn/nfse-mei
AppSupportURL=https://github.com/Giandonn/nfse-mei/issues
DefaultDirName={localappdata}\Programs\nfse-mei
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=nfse-mei-setup-{#Versao}
SetupIconFile=..\icone.ico
UninstallDisplayIcon={app}\icone.ico
UninstallDisplayName=nfse-mei
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=yes

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalho"; Description: "Criar um atalho na área de trabalho"

[Files]
Source: "..\..\dist\windows\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
; Atualização: tira os arquivos da versão anterior antes de copiar os novos (config e notas ficam em outras pastas).
Type: filesandordirs; Name: "{app}\app"

[Icons]
Name: "{userprograms}\nfse-mei"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\abrir.vbs"""; IconFilename: "{app}\icone.ico"; Comment: "Nota fiscal do MEI: painel e configuração"
Name: "{userdesktop}\nfse-mei"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\abrir.vbs"""; IconFilename: "{app}\icone.ico"; Comment: "Nota fiscal do MEI: painel e configuração"; Tasks: atalho

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\abrir.vbs"""; Description: "Abrir o nfse-mei agora"; Flags: postinstall nowait skipifsilent

[UninstallRun]
; Desliga a rotina diária antes de apagar os arquivos (o config e as notas da pessoa ficam).
Filename: "{app}\node\node.exe"; Parameters: """{app}\app\bin\nfse-mei.js"" agendar remover"; Flags: runhidden; RunOnceId: "DesligarRotina"
