@echo off
rem ============================================================
rem  One-click .vsix packaging (Windows entry, double-click to run)
rem  - Equivalent to: npm run package:vsix
rem    (cross-platform implementation: scripts/package-vsix.ts)
rem  - Full build (type-check + host + webview) -> vsce package -> release\
rem  - Usage: double-click; or CLI: package.bat [--clean]
rem    (--clean empties the release\ archive folder first)
rem  - NOTE: keep this file ASCII-only. cmd.exe parses batch files with
rem    the legacy ANSI codepage (e.g. GBK), so non-ASCII bytes in
rem    rem/echo lines get split into metacharacters and break parsing.
rem ============================================================
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js ^>= 20.19 first: https://nodejs.org/
  call :pause_if_interactive
  exit /b 1
)

echo === Packaging: full build + vsce package -^> release\ ===
call npm run package:vsix -- %*
set EXITCODE=%errorlevel%

echo.
if %EXITCODE% neq 0 (
  echo [FAILED] Packaging exited with code %EXITCODE%. See the log above.
) else (
  echo [DONE] .vsix archived under release\
)
call :pause_if_interactive
exit /b %EXITCODE%

rem Pause when double-clicked so the window stays open; set SKIP_PAUSE=1 to skip (CI/scripts).
:pause_if_interactive
if /i not "%SKIP_PAUSE%"=="1" pause
goto :eof
