@echo off
rem Run Grainfall from source on Windows. Needs Python 3.10+ from python.org.
cd /d "%~dp0"
python -m pip install --quiet --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo Could not install numpy and Pillow. Is Python installed and on PATH?
  pause
  exit /b 1
)
start "" pythonw run.py
