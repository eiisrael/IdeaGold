@echo off
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador para Huge Pages/MSR...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo ERRO: Node.js nao foi encontrado.
  pause
  exit /b 1
)

where git >nul 2>&1
if %errorlevel% equ 0 (
  git rev-parse --is-inside-work-tree >nul 2>&1
  if %errorlevel% equ 0 (
    set IDEAGOLD_DIRTY=
    for /f %%A in ('git status --porcelain') do set IDEAGOLD_DIRTY=1
    if not defined IDEAGOLD_DIRTY (
      echo Verificando atualizacoes do IdeaGold...
      git pull --ff-only >nul 2>&1
    )
  )
)

if not exist ".env" if exist ".env.example" copy /Y ".env.example" ".env" >nul

echo Verificando IdeaGold 4.1...
call npm run check
if %errorlevel% neq 0 (
  echo.
  echo ERRO: arquivos invalidos. Execute git pull e tente novamente.
  pause
  exit /b 1
)

call npm test
if %errorlevel% neq 0 (
  echo.
  echo ERRO: teste matematico GoldBrain falhou.
  pause
  exit /b 1
)

start "" "http://127.0.0.1:8080"
echo.
echo ==========================================
echo   IdeaGold 4.1 - GoldBrain Real
echo   Feche esta janela para parar o painel.
echo ==========================================
echo.
node server-v4.js
pause
