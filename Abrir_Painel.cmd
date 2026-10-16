@echo off
cd /d "%~dp0"
echo Iniciando painel privado. Abra http://127.0.0.1:4173 no navegador.
echo Mantenha esta janela aberta durante o uso.
node scripts/build.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
node scripts/serve.mjs
pause
