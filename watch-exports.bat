@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

REM Resolve Exports folder:
REM   1) INSTAMAT_EXPORTS env var
REM   2) exports-path.txt (one line = folder path)
REM   3) .\Exports next to this script

if not defined INSTAMAT_EXPORTS (
  if exist "%~dp0exports-path.txt" (
    for /f "usebackq tokens=* delims=" %%A in ("%~dp0exports-path.txt") do (
      set "LINE=%%A"
      if not "!LINE!"=="" if not "!LINE:~0,1!"=="#" (
        set "INSTAMAT_EXPORTS=%%A"
        goto :have_path
      )
    )
  )
)

:have_path
if not defined INSTAMAT_EXPORTS set "INSTAMAT_EXPORTS=%~dp0Exports"

echo.
echo Watching: %INSTAMAT_EXPORTS%
echo Drop Instamat/Materialize textures here. Press Ctrl+C to stop.
echo.

call npx tsx src/index.ts watch -f "%INSTAMAT_EXPORTS%" %*
echo.
pause
