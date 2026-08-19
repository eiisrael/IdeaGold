@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador para otimizar Huge Pages/MSR...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo ERRO: Node.js nao foi encontrado.
  echo Instale Node.js e execute este arquivo novamente.
  pause
  exit /b 1
)

rem Atualiza somente quando for uma pasta Git sem alteracoes locais.
where git >nul 2>&1
if %errorlevel% equ 0 (
  git rev-parse --is-inside-work-tree >nul 2>&1
  if %errorlevel% equ 0 (
    for /f %%A in ('git status --porcelain') do set IDEAGOLD_DIRTY=1
    if not defined IDEAGOLD_DIRTY (
      echo Verificando atualizacoes do IdeaGold...
      git pull --ff-only >nul 2>&1
    )
  )
)

if not exist ".env" (
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo Instalando dependencias do IdeaGold...
  call npm install
  if %errorlevel% neq 0 (
    echo Falha no npm install.
    pause
    exit /b 1
  )
)

echo Verificando arquivos do IdeaGold...
node --check server.js >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo ERRO: server.js possui erro de sintaxe.
  echo Execute git pull nesta pasta e tente novamente.
  echo.
  node --check server.js
  pause
  exit /b 1
)

start "" "http://127.0.0.1:8080"
echo.
echo ==========================================
echo   IdeaGold 3.0.1
 echo  Feche esta janela para parar o painel.
echo ==========================================
echo.
node server.js
pause
