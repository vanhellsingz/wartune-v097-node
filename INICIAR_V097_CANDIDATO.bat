@echo off
setlocal EnableExtensions
cd /d "%~dp0" || goto erro_pasta
title Wartune Ultra v0.9.7 — candidato local
echo Wartune Ultra v0.9.7 candidato
echo Pasta: %CD%
echo O servidor permanecera nesta janela visivel. Pressione Ctrl+C para encerramento seguro.
echo O MariaDB nao sera iniciado, reiniciado ou encerrado por este arquivo.
echo Nenhuma flag de desenvolvimento sera ativada.
echo.
where node >nul 2>nul || goto erro_node
node --version
if not exist "node_modules\mysql2\promise.js" goto erro_dependencia
node --check iniciar.js || goto erro_codigo
node iniciar.js
set "RESULTADO=%ERRORLEVEL%"
if not "%RESULTADO%"=="0" goto erro_execucao
echo.
echo Backend encerrado.
pause
exit /b 0

:erro_pasta
echo ERRO: nao foi possivel acessar a pasta desta candidata.
goto falha
:erro_node
echo ERRO: Node.js nao esta instalado ou nao esta no PATH.
goto falha
:erro_dependencia
echo ERRO: dependencia mysql2 ausente. Execute INSTALAR_DEPENDENCIAS.bat nesta pasta.
goto falha
:erro_codigo
echo ERRO: o inicializador falhou na verificacao de sintaxe.
goto falha
:erro_execucao
echo.
echo O backend terminou com erro. Consulte logs\inicializador-v097.log.
echo Nenhum processo externo foi encerrado.
:falha
pause
exit /b 1
