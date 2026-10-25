@echo off
echo Starting Reltio Workflow Adapter 2026.1.3.0...
echo.
echo Debugger available on port 5005 (attach IntelliJ/VS Code after startup)
echo Press Ctrl+C to stop.
echo.

:: Replace <JDK_PATH> with your actual JDK 17 bin path, e.g.:
::   C:\Program Files\Eclipse Adoptium\jdk-17.x.x.x-hotspot\bin
:: The review gate's build targets JDK 17 (the customer-repository provisioning template's pom.xml
:: pins maven-compiler-plugin's <release> to 17), so point this at a JDK 17 install even if a newer
:: JDK is also on this machine; that way what you run here matches what the pipeline builds.
:: Whether the adapter itself requires 17 has not been confirmed.

"<JDK_PATH>\java" ^
  -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 ^
  -Dfile.encoding=UTF-8 ^
  -Djava.net.preferIPv4Stack=true ^
  -DFS_DIR=C:/Reltio/workflow/ ^
  -DWORKFLOW_CONFIG_NAME=app.properties ^
  -jar C:/Reltio/workflow/web-2026.1.3.0.jar

pause
