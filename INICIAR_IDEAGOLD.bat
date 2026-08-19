@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title IdeaGold 5.0 - Supreme Mind

fltmc >nul 2>&1
if errorlevel 1 (
  echo [IdeaGold] Solicitando Administrador para Huge Pages / MSR...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ==============================================================
echo          IdeaGold 5.0 - Supreme Mind - inicializador
echo ==============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado. Instale Node.js 24 ou superior.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -p "process.versions.node"') do set NODEVER=%%v
echo [OK] Node.js %NODEVER%
node -e "const m=Number(process.versions.node.split('.')[0]); process.exit(m>=24?0:1)"
if errorlevel 1 (
  echo [ERRO] IdeaGold 5 requer Node.js 24 ou superior por causa do SQLite local.
  pause
  exit /b 1
)

if exist .git\ (
  git diff --quiet >nul 2>&1
  if not errorlevel 1 (
    git diff --cached --quiet >nul 2>&1
    if not errorlevel 1 (
      echo [INFO] Worktree limpo. Procurando atualizacao fast-forward...
      git pull --ff-only
      if errorlevel 1 echo [AVISO] Nao foi possivel atualizar agora; continuando com a versao local.
    )
  ) else (
    echo [INFO] Existem alteracoes locais. Git pull automatico foi ignorado.
  )
)

if not exist .env if exist .env.example copy /y .env.example .env >nul
if not exist node_modules\ (
  echo [INFO] Preparando dependencias locais...
  call npm install
  if errorlevel 1 goto :fail
)

echo [INFO] Validando codigo...
call npm run check
if errorlevel 1 goto :fail

echo [INFO] Executando testes matematicos e de seguranca...
call npm test
if errorlevel 1 goto :fail

echo.
echo [OK] Validacao concluida.
echo [INFO] Abrindo http://127.0.0.1:8080
start "" "http://127.0.0.1:8080"
echo [INFO] Fechar esta janela encerra apenas o painel Node; use PARAR MINERACAO antes de sair.
echo.
node backend\server.js
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo [ERRO] O IdeaGold nao iniciou porque uma validacao falhou.
echo Copie a mensagem acima se precisar de ajuda.
pause
exit /b 1
