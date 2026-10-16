# LCA Maven Project Templates (Per-Cloud)

> Doc ID: `KB-LCA-06` | Category: Implementation / Project Scaffold
> Full Maven POMs, assembly descriptors, build/deploy CLI. Handler code/patterns/fixtures: `02_LCA_IMPLEMENTATION_HANDBOOK.md`. Connectivity/ops: `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md`.
> Authoritative source for LCA Maven versions, POM scaffolds, packaging descriptors, build commands, and first-time cloud deploy CLI for new LCA projects.
> Pair with `02_LCA_IMPLEMENTATION_HANDBOOK.md` for handler code / I/O / tests, and `04_OPS_SECURITY_CONNECTIVITY_DEPLOYMENT.md` for connectivity, secrets, and ops.
> Azure Functions path below is the framework-repo model — confirm current Azure support vs. the S3-JAR note in `01_LCA_CORE_CONCEPTS_AND_HOOKS.md` §7 before committing a customer to either approach.

All templates are derived from the official Reltio `life-cycle-sample` patterns.
Replace `MY_LCA_PROJECT` / `my-lca` with your artifact names and pin `<lca-version>` to the current release (e.g. `2025.2.0.0`).

**Reltio Maven repository (required for all clouds):**
```
https://repo-dev.reltio.com/content/repositories/public
```

---

## Parent POM — Multi-Module Project

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <name>My LCA Project</name>
  <groupId>com.example.lca</groupId>
  <artifactId>my-lca-project</artifactId>
  <version>1.0.0</version>
  <packaging>pom</packaging>

  <modules>
    <!-- include only the module(s) you need -->
    <module>my-lca-lambda</module>
    <module>my-lca-googlefunction</module>
    <module>my-lca-azure-function</module>
  </modules>

  <properties>
    <!-- Pin to latest released LCA version -->
    <lca-version>2025.2.0.0</lca-version>
    <!-- Single verified Jackson baseline for all cloud modules -->
    <jackson.version>2.17.3</jackson.version>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.0</version>
        <configuration>
          <source>21</source>
          <target>21</target>
        </configuration>
      </plugin>
    </plugins>
  </build>

  <repositories>
    <repository>
      <id>reltio-libs-public</id>
      <name>Reltio public repository</name>
      <url>https://repo-dev.reltio.com/content/repositories/public</url>
    </repository>
  </repositories>
</project>
```

---

## AWS Lambda — Module POM

**Key artifact:** `life-cycle-framework-aws-lambda`  
**Base class:** `com.reltio.lifecycle.lambda.LifeCycleActionHandler`  
**Output:** `*-jar-with-dependencies.jar`

**Jackson version management note:** The Lambda POM uses `<dependencyManagement>` with explicit per-artifact overrides to upgrade Jackson independently of the Reltio BOM. This is the only reliable pattern when the parent POM has conflicting managed versions.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example.lca</groupId>
    <artifactId>my-lca-project</artifactId>
    <version>1.0.0</version>
  </parent>

  <name>My LCA — AWS Lambda</name>
  <artifactId>my-lca-lambda</artifactId>
  <version>1.0.0</version>

  <!--
    jackson.version inherited from the parent POM (single verified baseline).
    Explicit <dependencyManagement> entries below still override conflicting
    Reltio BOM managed versions in this Lambda module.
  -->

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-core</artifactId>
        <version>${jackson.version}</version>
      </dependency>
      <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-databind</artifactId>
        <version>${jackson.version}</version>
      </dependency>
      <dependency>
        <groupId>com.fasterxml.jackson.core</groupId>
        <artifactId>jackson-annotations</artifactId>
        <version>${jackson.version}</version>
      </dependency>
      <dependency>
        <groupId>com.fasterxml.jackson.dataformat</groupId>
        <artifactId>jackson-dataformat-smile</artifactId>
        <version>${jackson.version}</version>
      </dependency>
      <dependency>
        <groupId>com.fasterxml.jackson.dataformat</groupId>
        <artifactId>jackson-dataformat-cbor</artifactId>
        <version>${jackson.version}</version>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <dependencies>

    <!-- ── LCA framework (Lambda-specific base class) ── -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework-aws-lambda</artifactId>
      <version>${lca-version}</version>
    </dependency>

    <!-- Core framework interfaces -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <!-- Exclude all Jackson variants — managed by dependencyManagement above -->
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- LCA executor runtime -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-executor</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
        <exclusion><groupId>com.reltio.commons</groupId><artifactId>commons-library</artifactId></exclusion>
        <exclusion><groupId>io.swagger.core.v3</groupId><artifactId>swagger-annotations</artifactId></exclusion>
        <exclusion><groupId>commons-codec</groupId><artifactId>commons-codec</artifactId></exclusion>
        <exclusion><groupId>commons-collections</groupId><artifactId>commons-collections</artifactId></exclusion>
        <exclusion><groupId>io.github.lukehutch</groupId><artifactId>fast-classpath-scanner</artifactId></exclusion>
        <exclusion><groupId>org.apache.httpcomponents</groupId><artifactId>httpclient</artifactId></exclusion>
        <exclusion><groupId>com.esotericsoftware</groupId><artifactId>kryo</artifactId></exclusion>
        <exclusion><groupId>joda-time</groupId><artifactId>joda-time</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- Jackson — versions managed by dependencyManagement above -->
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-core</artifactId>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.dataformat</groupId>
      <artifactId>jackson-dataformat-smile</artifactId>
    </dependency>

    <!-- AWS Lambda runtime -->
    <dependency>
      <groupId>com.amazonaws</groupId>
      <artifactId>aws-lambda-java-core</artifactId>
      <version>1.2.1</version>
    </dependency>
    <dependency>
      <groupId>com.amazonaws</groupId>
      <artifactId>aws-java-sdk-core</artifactId>
      <version>1.12.178</version>
      <exclusions>
        <exclusion><groupId>joda-time</groupId><artifactId>joda-time</artifactId></exclusion>
        <exclusion><groupId>commons-logging</groupId><artifactId>commons-logging</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- Logging: use the Lambda runtime-provided backend; do not pin Log4j 1.x -->

    <!-- ── Test dependencies ── -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-test-framework</artifactId>
      <version>${lca-version}</version>
      <scope>test</scope>
      <exclusions>
        <exclusion><groupId>com.reltio.services.lca</groupId><artifactId>reltio-lca-service</artifactId></exclusion>
      </exclusions>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.8.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>4.7.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.skyscreamer</groupId>
      <artifactId>jsonassert</artifactId>
      <version>1.3.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.0</version>
        <configuration><source>21</source><target>21</target></configuration>
      </plugin>

      <!-- Fat JAR — required for Lambda deployment -->
      <plugin>
        <artifactId>maven-assembly-plugin</artifactId>
        <executions>
          <execution>
            <phase>package</phase>
            <goals><goal>single</goal></goals>
            <configuration>
              <descriptorRefs>
                <descriptorRef>jar-with-dependencies</descriptorRef>
              </descriptorRefs>
            </configuration>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>2.22.2</version>
      </plugin>

      <!-- JaCoCo — CI gate at ≥ 92 % line coverage -->
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.12</version>
        <executions>
          <execution><id>agent-for-ut</id><goals><goal>prepare-agent</goal></goals></execution>
          <execution><id>agent-for-it</id><goals><goal>prepare-agent-integration</goal></goals></execution>
          <execution>
            <id>report</id>
            <phase>prepare-package</phase>
            <goals><goal>report</goal></goals>
          </execution>
          <execution>
            <id>jacoco-check</id>
            <goals><goal>check</goal></goals>
            <configuration>
              <rules>
                <rule>
                  <element>PACKAGE</element>
                  <limits>
                    <limit>
                      <counter>LINE</counter>
                      <value>COVEREDRATIO</value>
                      <minimum>0.92</minimum>
                    </limit>
                  </limits>
                </rule>
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

---

## Google Cloud Functions — Module POM

**Key artifact:** `life-cycle-framework-google-function`  
**Base class:** `com.reltio.lifecycle.googlefunction.LifeCycleGoogleFunction`  
**Output:** `*-jar-with-dependencies.jar` + `*-zip-with-dependencies.zip`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example.lca</groupId>
    <artifactId>my-lca-project</artifactId>
    <version>1.0.0</version>
  </parent>

  <name>My LCA — Google Cloud Functions</name>
  <artifactId>my-lca-googlefunction</artifactId>
  <version>1.0.0</version>

  <!-- jackson.version inherited from parent (2.17.3 baseline) -->

  <dependencies>

    <!-- ── LCA framework (GCF-specific base class) ── -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework-google-function</artifactId>
      <version>${lca-version}</version>
    </dependency>

    <!-- Core framework interfaces -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- LCA executor runtime -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-executor</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
        <exclusion><groupId>com.reltio.commons</groupId><artifactId>commons-library</artifactId></exclusion>
        <exclusion><groupId>io.swagger.core.v3</groupId><artifactId>swagger-annotations</artifactId></exclusion>
        <exclusion><groupId>commons-codec</groupId><artifactId>commons-codec</artifactId></exclusion>
        <exclusion><groupId>commons-collections</groupId><artifactId>commons-collections</artifactId></exclusion>
        <exclusion><groupId>io.github.lukehutch</groupId><artifactId>fast-classpath-scanner</artifactId></exclusion>
        <exclusion><groupId>org.apache.httpcomponents</groupId><artifactId>httpclient</artifactId></exclusion>
        <exclusion><groupId>com.esotericsoftware</groupId><artifactId>kryo</artifactId></exclusion>
        <exclusion><groupId>joda-time</groupId><artifactId>joda-time</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- Jackson (explicit version) -->
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-core</artifactId>
      <version>${jackson.version}</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
      <version>${jackson.version}</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.dataformat</groupId>
      <artifactId>jackson-dataformat-smile</artifactId>
      <version>${jackson.version}</version>
    </dependency>

    <!-- Logging: use the GCF runtime-provided backend; do not pin Log4j 1.x -->

    <!-- ── Test dependencies ── -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-test-framework</artifactId>
      <version>${lca-version}</version>
      <scope>test</scope>
      <exclusions>
        <exclusion><groupId>com.reltio.services.lca</groupId><artifactId>reltio-lca-service</artifactId></exclusion>
      </exclusions>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.8.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>4.7.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.skyscreamer</groupId>
      <artifactId>jsonassert</artifactId>
      <version>1.3.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.0</version>
        <configuration><source>21</source><target>21</target></configuration>
      </plugin>

      <!-- Fat JAR + ZIP — both required for GCF deployment -->
      <plugin>
        <artifactId>maven-assembly-plugin</artifactId>
        <executions>
          <!-- 1. Fat JAR -->
          <execution>
            <phase>package</phase>
            <goals><goal>single</goal></goals>
            <configuration>
              <descriptorRefs>
                <descriptorRef>jar-with-dependencies</descriptorRef>
              </descriptorRefs>
            </configuration>
          </execution>
          <!-- 2. ZIP wrapping the fat JAR -->
          <execution>
            <id>make-zip</id>
            <phase>package</phase>
            <goals><goal>single</goal></goals>
            <configuration>
              <descriptors>
                <descriptor>src/assembly/zip.xml</descriptor>
              </descriptors>
            </configuration>
          </execution>
        </executions>
      </plugin>

      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>2.22.2</version>
      </plugin>

      <!-- JaCoCo — CI gate at ≥ 92 % line coverage -->
      <plugin>
        <groupId>org.jacoco</groupId>
        <artifactId>jacoco-maven-plugin</artifactId>
        <version>0.8.12</version>
        <executions>
          <execution><id>agent-for-ut</id><goals><goal>prepare-agent</goal></goals></execution>
          <execution><id>agent-for-it</id><goals><goal>prepare-agent-integration</goal></goals></execution>
          <execution>
            <id>report</id>
            <phase>prepare-package</phase>
            <goals><goal>report</goal></goals>
          </execution>
          <execution>
            <id>jacoco-check</id>
            <goals><goal>check</goal></goals>
            <configuration>
              <rules>
                <rule>
                  <element>PACKAGE</element>
                  <limits>
                    <limit>
                      <counter>LINE</counter>
                      <value>COVEREDRATIO</value>
                      <minimum>0.92</minimum>
                    </limit>
                  </limits>
                </rule>
              </rules>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

### GCF Assembly Descriptor — `src/assembly/zip.xml`

```xml
<assembly>
  <id>zip-with-dependencies</id>
  <formats>
    <format>zip</format>
  </formats>
  <includeBaseDirectory>false</includeBaseDirectory>
  <files>
    <file>
      <source>
        ${project.build.directory}/${project.artifactId}-${project.version}-jar-with-dependencies.jar
      </source>
      <outputDirectory>/</outputDirectory>
    </file>
  </files>
</assembly>
```

---

## Azure Functions — Module POM

**Key artifact:** `life-cycle-framework-azure-function`  
**Base class:** `com.reltio.lifecycle.azurefunction.LifeCycleAzureFunction`  
**Output:** Azure Functions deployment ZIP (via `azure-functions-maven-plugin` + custom assembly)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
             http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>com.example.lca</groupId>
    <artifactId>my-lca-project</artifactId>
    <version>1.0.0</version>
  </parent>

  <name>My LCA — Azure Functions</name>
  <artifactId>my-lca-azure-function</artifactId>
  <version>1.0.0</version>

  <properties>
    <maven.compiler.source>21</maven.compiler.source>
    <maven.compiler.target>21</maven.compiler.target>
    <!-- jackson.version inherited from parent (2.17.3 baseline) -->
    <azure.functions.maven.plugin.version>1.36.0</azure.functions.maven.plugin.version>
    <!-- Matches the Azure Function App name used in @FunctionName annotations -->
    <functionAppName>azure-lca</functionAppName>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <dependencies>

    <!-- ── LCA framework (Azure-specific base class) ── -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework-azure-function</artifactId>
      <version>${lca-version}</version>
    </dependency>

    <!-- Core framework interfaces -->
    <dependency>
      <groupId>com.reltio</groupId>
      <artifactId>life-cycle-framework</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- LCA executor runtime -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-executor</artifactId>
      <version>${lca-version}</version>
      <exclusions>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-core</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-annotations</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.core</groupId><artifactId>jackson-databind</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.jackson.dataformat</groupId><artifactId>jackson-dataformat-cbor</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-core-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-databind-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-dataformat-smile-shaded</artifactId></exclusion>
        <exclusion><groupId>com.fasterxml.reltio</groupId><artifactId>jackson-module-jaxb-annotations-shaded</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-core-asl</artifactId></exclusion>
        <exclusion><groupId>org.codehaus.jackson</groupId><artifactId>jackson-mapper-asl</artifactId></exclusion>
        <exclusion><groupId>com.reltio.commons</groupId><artifactId>commons-library</artifactId></exclusion>
        <exclusion><groupId>io.swagger.core.v3</groupId><artifactId>swagger-annotations</artifactId></exclusion>
        <exclusion><groupId>commons-codec</groupId><artifactId>commons-codec</artifactId></exclusion>
        <exclusion><groupId>commons-collections</groupId><artifactId>commons-collections</artifactId></exclusion>
        <exclusion><groupId>io.github.lukehutch</groupId><artifactId>fast-classpath-scanner</artifactId></exclusion>
        <exclusion><groupId>org.apache.httpcomponents</groupId><artifactId>httpclient</artifactId></exclusion>
        <exclusion><groupId>com.esotericsoftware</groupId><artifactId>kryo</artifactId></exclusion>
        <exclusion><groupId>joda-time</groupId><artifactId>joda-time</artifactId></exclusion>
      </exclusions>
    </dependency>

    <!-- ── Test dependencies ── -->
    <dependency>
      <groupId>com.reltio.services.lca</groupId>
      <artifactId>reltio-lca-test-framework</artifactId>
      <version>${lca-version}</version>
      <scope>test</scope>
      <exclusions>
        <exclusion><groupId>com.reltio.services.lca</groupId><artifactId>reltio-lca-service</artifactId></exclusion>
      </exclusions>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.8.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.mockito</groupId>
      <artifactId>mockito-core</artifactId>
      <version>4.7.0</version>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.skyscreamer</groupId>
      <artifactId>jsonassert</artifactId>
      <version>1.3.0</version>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.8.1</version>
        <configuration>
          <source>21</source>
          <target>21</target>
          <encoding>${project.build.sourceEncoding}</encoding>
        </configuration>
      </plugin>

      <!--
        Azure Functions Maven Plugin:
        - Generates function.json per @FunctionName class
        - Packages into target/azure-functions/<functionAppName>/
      -->
      <plugin>
        <groupId>com.microsoft.azure</groupId>
        <artifactId>azure-functions-maven-plugin</artifactId>
        <version>${azure.functions.maven.plugin.version}</version>
        <configuration>
          <appName>${functionAppName}</appName>
          <resourceGroup>java-functions-group</resourceGroup>        <!-- update -->
          <region>westus</region>                                    <!-- update -->
          <appServicePlanName>java-functions-app-service-plan</appServicePlanName>
          <runtime>
            <os>linux</os>   <!-- linux recommended; use windows if required -->
            <javaVersion>21</javaVersion>
          </runtime>
          <appSettings>
            <property>
              <name>FUNCTIONS_EXTENSION_VERSION</name>
              <value>~4</value>
            </property>
          </appSettings>
        </configuration>
        <executions>
          <execution>
            <id>package-functions</id>
            <goals><goal>package</goal></goals>
          </execution>
        </executions>
      </plugin>

      <!-- Remove .NET obj folder generated by some tooling -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-clean-plugin</artifactId>
        <version>3.1.0</version>
        <configuration>
          <filesets>
            <fileset><directory>obj</directory></fileset>
          </filesets>
        </configuration>
      </plugin>

      <!--
        Assembly Plugin:
        Packages the Azure Functions output directory into a ZIP for CLI deployment.
        The descriptor reads from target/azure-functions/<functionAppName>/
      -->
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-assembly-plugin</artifactId>
        <version>3.7.1</version>
        <configuration>
          <finalName>${project.version}</finalName>
          <descriptors>
            <descriptor>src/assembly/azure-function-zip.xml</descriptor>
          </descriptors>
        </configuration>
        <executions>
          <execution>
            <id>make-assembly</id>
            <phase>package</phase>
            <goals><goal>single</goal></goals>
          </execution>
        </executions>
      </plugin>
    </plugins>
  </build>
</project>
```

### Azure Assembly Descriptor — `src/assembly/azure-function-zip.xml`

```xml
<assembly>
  <id>azure-function-deployment</id>
  <formats>
    <format>zip</format>
  </formats>
  <includeBaseDirectory>false</includeBaseDirectory>
  <fileSets>
    <fileSet>
      <directory>${project.build.directory}/azure-functions/${functionAppName}</directory>
      <outputDirectory>/</outputDirectory>
      <includes>
        <include>**/*</include>
      </includes>
    </fileSet>
  </fileSets>
</assembly>
```

### Azure `host.json`

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

### Azure `local.settings.json` (local development — never commit)

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "java"
  }
}
```

---

## Build Commands

```bash
# Build all modules and run tests
mvn clean package

# Build a single module
mvn clean package -pl my-lca-lambda

# Skip tests (not for production builds)
mvn clean package -DskipTests

# View JaCoCo coverage report
open target/site/jacoco/index.html
```

---

## Deployment Steps — Per Cloud

### AWS Lambda

**Step 1: Build**
```bash
mvn clean package -pl my-lca-lambda
# Output: my-lca-lambda/target/my-lca-lambda-1.0.0-jar-with-dependencies.jar
```

**Step 2: Upload to S3 and create/update the function**
```bash
AWS_PROFILE=my-target-profile
AWS_REGION=us-east-1
S3_BUCKET=lifecycle-actions
FUNCTION_NAME=my-lca-before-save
HANDLER=com.reltio.lifecycle.lambda.LcaJarExecutionLambdaHandler
# (or use your own handler class for new-style LCAs)

# Create S3 bucket if needed (skip us-east-1 LocationConstraint)
aws s3api create-bucket \
  --bucket "$S3_BUCKET" --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION" \
  --profile "$AWS_PROFILE"

# Upload ZIP
aws s3 cp my-lca-lambda/target/my-lca-lambda-1.0.0-jar-with-dependencies.jar \
  "s3://${S3_BUCKET}/lambda-packages/${FUNCTION_NAME}.jar" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"

# Create function (first time)
aws lambda create-function \
  --function-name "$FUNCTION_NAME" \
  --runtime java21 \
  --role "arn:aws:iam::ACCOUNT:role/lambda_basic_execution_role" \
  --handler "$HANDLER" \
  --code "S3Bucket=${S3_BUCKET},S3Key=lambda-packages/${FUNCTION_NAME}.jar" \
  --timeout 30 --memory-size 512 \
  --environment '{"Variables":{"lca_class_name":"com.example.lca.MyBeforeSaveAction"}}' \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"

# Update code (subsequent deployments)
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --s3-bucket "$S3_BUCKET" \
  --s3-key "lambda-packages/${FUNCTION_NAME}.jar" \
  --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

**Step 3: Verify**
```bash
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --payload fileb://test-payload.json \
  --profile "$AWS_PROFILE" --region "$AWS_REGION" \
  response.json
cat response.json
```

**Step 4: Register in Reltio tenant config**
```json
{
  "beforeSave": ["Lambda/BinaryJSON/my-lca-before-save"]
}
```

---

### Google Cloud Functions

**Step 1: Build**
```bash
mvn clean package -pl my-lca-googlefunction
# Outputs:
#   my-lca-googlefunction/target/my-lca-googlefunction-1.0.0-jar-with-dependencies.jar
#   my-lca-googlefunction/target/my-lca-googlefunction-1.0.0-zip-with-dependencies.zip
```

**Step 2: Set up GCP**
```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project MY_GCP_PROJECT
# Enable required APIs
gcloud services enable cloudfunctions.googleapis.com cloudbuild.googleapis.com storage.googleapis.com
```

**Step 3: Create GCS bucket (if needed)**
```bash
BUCKET=lifecycleaction
REGION=us-central1
gsutil mb -p MY_GCP_PROJECT -l "$REGION" "gs://$BUCKET"
```

**Step 4: Upload ZIP and deploy function**
```bash
FUNCTION_NAME=my-lca-before-save
ZIP_FILE=my-lca-googlefunction/target/my-lca-googlefunction-1.0.0-zip-with-dependencies.zip
ENTRY_POINT=com.reltio.lifecycle.googlefunction.LcaJarExecutionGoogleHandler
# For new-style LCAs, use your own class as entry point

# Upload ZIP to GCS
gsutil cp "$ZIP_FILE" "gs://$BUCKET/${FUNCTION_NAME}.zip"

# Deploy Gen2 Cloud Function (authenticated — matches KB-LCA-04 connectivity setup)
RELTIO_INVOKER_SA=customer-lca-invoker@MY_GCP_PROJECT.iam.gserviceaccount.com
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=java21 \
  --region="$REGION" \
  --source="gs://$BUCKET/${FUNCTION_NAME}.zip" \
  --entry-point="$ENTRY_POINT" \
  --memory=512MB \
  --timeout=60s \
  --set-env-vars="lca_class_name=com.example.lca.MyBeforeSaveAction" \
  --trigger-http \
  --no-allow-unauthenticated \
  --project=MY_GCP_PROJECT

# Grant the Reltio-impersonated customer service account invoker permission
gcloud functions add-invoker-policy-binding "$FUNCTION_NAME" \
  --gen2 --region="$REGION" --project=MY_GCP_PROJECT \
  --member="serviceAccount:${RELTIO_INVOKER_SA}"
```

**Step 5: Get the function URL**
```bash
gcloud functions describe "$FUNCTION_NAME" \
  --gen2 --region="$REGION" --project=MY_GCP_PROJECT \
  --format='value(serviceConfig.uri)'
```

**Step 6: Register in Reltio tenant config**
```json
{
  "lifecycleActions": {
    "beforeSave": [
      "googlefunction/BinaryJSON/https://us-central1-MY_GCP_PROJECT.cloudfunctions.net/my-lca-before-save"
    ]
  }
}
```

**Update (subsequent deployments):**
```bash
gsutil cp "$ZIP_FILE" "gs://$BUCKET/${FUNCTION_NAME}.zip"
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 --runtime=java21 --region="$REGION" \
  --source="gs://$BUCKET/${FUNCTION_NAME}.zip" \
  --entry-point="$ENTRY_POINT" \
  --project=MY_GCP_PROJECT
```

---

### Azure Functions

**Step 1: Build**
```bash
mvn clean package -pl my-lca-azure-function
# Output: my-lca-azure-function/target/<version>-azure-function-deployment.zip
```

**Step 2: Log in and set subscription**
```bash
az login
az account set --subscription MY_SUBSCRIPTION_ID
```

**Step 3: Create Azure resources**
```bash
RG=ReltioLcaRG
LOCATION=eastus
STORAGE=reltiofunctionsstorage    # globally unique, 3-24 chars, lowercase+numbers
FUNCTION_APP=reltio-TENANT-my-lca-before-save

# Resource group
az group create --name "$RG" --location "$LOCATION"

# Storage account
az storage account create \
  --name "$STORAGE" --resource-group "$RG" \
  --location "$LOCATION" --sku Standard_LRS

# Function App (Consumption / Y1 plan — Linux recommended)
az functionapp create \
  --name "$FUNCTION_APP" \
  --storage-account "$STORAGE" \
  --resource-group "$RG" \
  --consumption-plan-location "$LOCATION" \
  --runtime java \
  --runtime-version 21 \
  --os-type Linux
```

**Step 4: Configure app settings**
```bash
az functionapp config appsettings set \
  --name "$FUNCTION_APP" --resource-group "$RG" \
  --settings \
    "FUNCTIONS_WORKER_RUNTIME=java" \
    "FUNCTIONS_EXTENSION_VERSION=~4" \
    "WEBSITE_RUN_FROM_PACKAGE=1" \
    "lca_class_name=com.example.lca.MyBeforeSaveAction"
```

**Step 5: Deploy ZIP**
```bash
ZIP_FILE=my-lca-azure-function/target/1.0.0-azure-function-deployment.zip

# Retry logic built into the generated scripts (3 attempts, 15s between retries)
az functionapp deployment source config-zip \
  --resource-group "$RG" \
  --name "$FUNCTION_APP" \
  --src "$ZIP_FILE" \
  --timeout 600
```

**Step 6: Get the function URL**
```bash
az functionapp show --name "$FUNCTION_APP" --resource-group "$RG" \
  --query defaultHostName -o tsv
# URL format: https://<FUNCTION_APP>.azurewebsites.net/api/<FunctionName>
```

**Step 7: Register in Reltio tenant config**
```json
{
  "lifecycleActions": {
    "beforeSave": [
      "AzureFunction/BinaryJSON/https://reltio-TENANT-my-lca-before-save.azurewebsites.net/api/BeforeSaveEntityAction"
    ]
  }
}
```

**Important Azure notes:**
- `StorageAccountAlreadyTaken (409)`: Storage account names are globally unique. If the name is taken in another subscription, choose a different name.
- `Consumption quota (401)`: Some subscriptions have zero quota for Linux Consumption (Y1) in a region. Request an increase via Azure Portal, or switch to an EP1 Premium Elastic plan.
- Java 21 requires `azure.runtime=21.0` (not `21`) in deployer config.
- Use **Linux** (`--os-type Linux`) — it is recommended over Windows for Java workloads.

---

## Unified Cloud Deployer (for migrating existing legacy LCAs)

The `unified-cloud-deployer` tool is used by **Reltio Customer Engineering** to migrate existing customer LCA JARs to serverless functions without code changes. It uses a two-step process:

| Step | Who runs it | What happens |
|---|---|---|
| **Step 1** | Reltio CE / Support | Downloads customer JARs from Reltio S3, packages with base handler, generates `terraform-values.json` and per-LCA deploy packages under `<tenant.id>/dest/` |
| **Step 2** | You (the customer) | Runs Terraform from `terraform/aws`, `terraform/gcp`, or `terraform/azure` using your cloud credentials to deploy the packages |

**For new LCA development, use the per-cloud Maven modules above** — the unified deployer is only for migrating existing legacy JARs.

**Config properties template** (`config.properties`):
```properties
cloud.provider=gcp          # aws | gcp | azure
tenant.id=MY_TENANT
lca.api.url=https://lca-tst.reltio.com
# Use env var LCA_API_TOKEN (do not commit token)
lca.api.token=

aws.region=us-east-1
gcp.project.id=my-project
gcp.region=us-central1
gcp.bucket=lifecycleaction
azure.resourceGroup=ReltioLcaRG
azure.location=eastus
azure.storageAccount=reltiofunctionsstorage
azure.functionAppPrefix=reltio
azure.appServicePlan.sku=Y1   # Y1=Consumption, EP1=Premium

# Base handlers (Reltio-managed — do not change)
lambda.base.handler=com.reltio.lifecycle.lambda.LcaJarExecutionLambdaHandler
gcp.base.handler=com.reltio.lifecycle.googlefunction.LcaJarExecutionGoogleHandler
azure.base.handler=com.reltio.lifecycle.azurefunction.LcaJarExecutionAzureHandler

# Security — production must keep verification enabled (skip=false)
reltio.checksum.verify.skip=false
```

**Run Step 1:**
```bash
mvn clean package -pl unified-cloud-deployer
java -jar unified-cloud-deployer/target/unified-cloud-deployer-1.0.0-jar-with-dependencies.jar \
     config.properties
```

**Run Step 2 (Terraform):**
```bash
cd terraform/gcp   # or terraform/aws / terraform/azure
./apply.sh
```

---

## Project Directory Structure

```
my-lca-project/
├── pom.xml                                (parent)
├── my-lca-lambda/
│   ├── pom.xml
│   └── src/
│       ├── main/java/com/example/lca/
│       │   ├── entities/BeforeSaveEntityAction.java
│       │   └── relations/BeforeSaveRelationAction.java
│       └── test/
│           ├── java/.../BeforeSaveEntityActionTest.java
│           └── resources/entities/beforesave/input.json
├── my-lca-googlefunction/
│   ├── pom.xml
│   └── src/
│       ├── assembly/zip.xml
│       ├── main/java/com/example/lca/...
│       └── test/...
└── my-lca-azure-function/
    ├── pom.xml
    └── src/
        ├── assembly/azure-function-zip.xml
        ├── main/java/com/example/lca/...
        └── test/...
```
