@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%dev-local.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERR ] dev-local startup failed with exit code %EXIT_CODE%.
    echo [ERR ] You can check logs under: %SCRIPT_DIR%..\logs\local-dev
    if /I not "%DEER_FLOW_NO_PAUSE_ON_ERROR%"=="1" (
        echo.
        pause
    )
)

endlocal & exit /b %EXIT_CODE%
