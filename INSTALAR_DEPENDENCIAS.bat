@echo off
cd /d "%~dp0"
echo Instalando dependencia mysql2 no projeto local...
call npm.cmd install --ignore-scripts
if errorlevel 1 (
 echo Instalacao falhou. Confira a internet e a versao do Node.js.
) else (
 echo Dependencias instaladas.
)
pause
