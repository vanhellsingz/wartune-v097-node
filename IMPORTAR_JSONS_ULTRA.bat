@echo off
chcp 65001 >nul
cd /d "%~dp0"
node importar_catalogo_ultra.js
pause
