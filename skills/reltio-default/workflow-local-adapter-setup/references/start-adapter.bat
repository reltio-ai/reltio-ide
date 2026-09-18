@echo off
echo Starting Reltio Workflow Adapter 2026.1.3.0...
echo.
echo Debugger available on port 5005 (attach IntelliJ/VS Code after startup)
echo Press Ctrl+C to stop.
echo.

:: Replace <JDK_PATH> with your actual JDK bin path, e.g.:
::   C:\Program Files\Eclipse Adoptium\jdk-17.x.x.x-hotspot\bin
::   C:\Program Files\Java\jdk-25.0.2\bin

"<JDK_PATH>\java" ^
  -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 ^
  -Dfile.encoding=UTF-8 ^
  -Djava.net.preferIPv4Stack=true ^
  -DFS_DIR=C:/Reltio/workflow/ ^
  -DWORKFLOW_CONFIG_NAME=app.properties ^
  -jar C:/Reltio/workflow/web-2026.1.3.0.jar

pause
