@echo off
rem Build a standalone Grainfall.exe (no Python needed to run it).
rem Needs Python 3.10+ from python.org. The result is dist\Grainfall.exe.
cd /d "%~dp0"
python -m pip install --quiet --disable-pip-version-check -r requirements.txt pyinstaller
if errorlevel 1 goto :fail
python make_icon.py
if errorlevel 1 goto :fail
python -m PyInstaller --noconfirm --clean --onefile --windowed --hidden-import PIL._tkinter_finder --name Grainfall --icon grainfall.ico run.py
if errorlevel 1 goto :fail
echo.
echo Built dist\Grainfall.exe
exit /b 0
:fail
echo Build failed.
pause
exit /b 1
