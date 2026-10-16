@echo off
cd /d "%~dp0"
echo Crie uma conta individual para cada pessoa que vai usar o painel.
echo A conta do painel e diferente da conta do GitHub.
node scripts/configure.mjs
pause
