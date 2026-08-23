@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

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

echo Inspecting: %INSTAMAT_EXPORTS%
echo.
call npx tsx src/index.ts inspect -f "%INSTAMAT_EXPORTS%" %*
echo.
pause
