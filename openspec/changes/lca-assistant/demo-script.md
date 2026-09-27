# LCA assistant demo

1. What does the `beforeSave` hook do?
2. Using the connected tenant L3, generate a beforeSave LCA. This is a code-generation confirmation: show attributes the LCA will **read** before writing code. Do not edit L3 until the user confirms the `lifecycleActions` diff.
3. Scaffold a Maven LCA project only after the user agrees. `mvn package` is not a gate.

## Tenant gate

If no tenant connected, stop and ask the user to connect.

## Unknown type

If the user names a near-miss type such as CourseTopics, stop, list available entity types, and confirm the actual name.
