' nfse-mei: abre o painel sem janela de terminal (atalho do Menu Iniciar e da área de trabalho).
' Usa o Node que vem junto no instalador, na pasta "node" ao lado deste arquivo.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run """" & pasta & "\node\node.exe"" """ & pasta & "\app\bin\nfse-mei.js""", 0, False
