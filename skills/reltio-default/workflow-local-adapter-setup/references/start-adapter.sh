#!/bin/bash
# Reltio Workflow Adapter — Mac/Linux start script
# Edit the two variables below before running.

# Your JDK bin path — examples:
#   Mac (Homebrew): /opt/homebrew/opt/openjdk@17/bin
#   Mac (manual):   /Library/Java/JavaVirtualMachines/jdk-17.x.x.jdk/Contents/Home/bin
#   Linux:          /usr/lib/jvm/java-17-openjdk-amd64/bin
JAVA_BIN="/path/to/jdk/bin"

# Adapter JAR version — platform-independent, same JAR on Mac/Windows/Linux
VERSION="2026.1.3.0"

echo "Starting Reltio Workflow Adapter ${VERSION}..."
echo "Debugger available on port 5005"
echo "Press Ctrl+C to stop."
echo ""

"${JAVA_BIN}/java" \
  -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005 \
  -Dfile.encoding=UTF-8 \
  -Djava.net.preferIPv4Stack=true \
  -DFS_DIR="${HOME}/Reltio/workflow/" \
  -DWORKFLOW_CONFIG_NAME=app.properties \
  -jar "${HOME}/Reltio/workflow/web-${VERSION}.jar"
