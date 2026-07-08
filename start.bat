@echo off
REM ============================================================
REM  Minecraft 伺服器管理工具 - 啟動腳本
REM  一律使用專案內的虛擬環境 (.venv) 來啟動，確保依賴隔離。
REM
REM  用法：
REM    start.bat                  只綁本機 127.0.0.1（最安全，預設）
REM    start.bat remote           綁本機的 Tailscale IP，讓 tailnet 內的裝置遠端連入
REM    start.bat remote 100.x.x.x 指定要綁的 IP（自動偵測失敗時手動指定）
REM  注意：絕不綁 0.0.0.0（會對區網/公網開放）。remote 的 IP 為執行時動態偵測，
REM        不會寫進任何檔案，因此不會進版控外洩。
REM ============================================================
chcp 65001 >nul
setlocal enableextensions
cd /d "%~dp0"

set "VENV_PY=.venv\Scripts\python.exe"

REM ---- 決定要綁哪個位址（HOST）----
set "HOST=127.0.0.1"
if /i "%~1"=="remote" goto remote
goto afterhost

:remote
REM 有指定第二個參數就用它當 IP；否則向 Tailscale 動態查詢（不寫死、不進版控）
if not "%~2"=="" set "HOST=%~2"
if not "%~2"=="" goto afterhost
set "TSIP="
for /f "usebackq delims=" %%i in (`tailscale ip -4 2^>nul`) do if not defined TSIP set "TSIP=%%i"
if not defined TSIP goto err_tsip
set "HOST=%TSIP%"
goto afterhost

:afterhost
REM 沒有虛擬環境就先建立並安裝套件；有的話直接檢查套件
if not exist "%VENV_PY%" goto setup
goto checkdeps

:setup
echo [start] 找不到虛擬環境，正在建立 .venv ...
python -m venv .venv
if errorlevel 1 goto err_py
echo [start] 安裝相依套件 ...
"%VENV_PY%" -m pip install -r backend\requirements.txt
if errorlevel 1 goto err_pip
goto run

:checkdeps
"%VENV_PY%" -m uvicorn --version >nul 2>&1
if errorlevel 1 goto setupdeps
goto run

:setupdeps
echo [start] 虛擬環境內缺少套件，正在安裝 ...
"%VENV_PY%" -m pip install -r backend\requirements.txt
if errorlevel 1 goto err_pip
goto run

:run
echo [start] 使用虛擬環境： %VENV_PY%
echo [start] 服務啟動中，請用瀏覽器開啟： http://%HOST%:8000
if /i "%~1"=="remote" echo [start] （遠端裝置需在同一個 Tailscale 網路才連得到；防火牆若擋 8000 埠請放行）
echo [start] 按 Ctrl+C 可停止服務。
REM --app-dir backend 讓 uvicorn 找得到 backend\main.py；--host 由上面決定
"%VENV_PY%" -m uvicorn main:app --app-dir backend --host %HOST% --port 8000 --reload
goto end

:err_tsip
echo [start] 抓不到 Tailscale IP。請確認 Tailscale 已安裝並啟動，或手動指定：
echo         start.bat remote 100.x.x.x
pause
exit /b 1

:err_py
echo [start] 建立虛擬環境失敗，請確認已安裝 Python 並加入 PATH。
pause
exit /b 1

:err_pip
echo [start] 套件安裝失敗，請檢查網路或 backend\requirements.txt。
pause
exit /b 1

:end
endlocal
