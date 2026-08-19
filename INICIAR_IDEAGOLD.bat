@echo off
setlocal
cd /d "%~dp0"
title IdeaGold 5.0 - Mining Intelligence

echo ===============================================
echo  IdeaGold 5.0 - Mining Intelligence Platform
echo ===============================================
echo.
echo O IdeaGold usa privilegio de Administrador somente para permitir
 echo Huge Pages/MSR quando o XMRig precisar. Nenhuma protecao do Windows
 echo sera desativada e nenhuma mineracao sera iniciada escondida.
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo O Windows vai pedir permissao de Administrador agora.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERRO: Node.js nao foi encontrado. Instale Node.js 22.5 ou superior.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
  echo ERRO: IdeaGold 5.0 requer Node.js 22.5 ou superior por causa do SQLite local.
  node -v
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.example" copy /Y ".env.example" ".env" >nul

echo [1/2] Validando codigo...
call npm run check
if %errorlevel% neq 0 (
  echo.
  echo ERRO: validacao de sintaxe falhou. Nada sera iniciado.
  pause
  exit /b 1
)

echo [2/2] Executando testes...
call npm test
if %errorlevel% neq 0 (
  echo.
  echo ERRO: testes falharam. Nada sera iniciado.
  pause
  exit /b 1
)

echo.
echo Validacao concluida. Abrindo painel local...
start "" "http://127.0.0.1:8080"
echo.
echo Feche esta janela para encerrar o PAINEL.
echo Use o botao PARAR MINERACAO antes de fechar se o XMRig estiver ativo.
echo.
node backend\server.js
pause
