# Scene Auditor example extension

This is an illustrative declarative extension package for SAMP.AI.

It demonstrates how a community skill can orchestrate an existing read-only mapping inspection tool to review a project. It does not contain executable plugin code and cannot modify the server.

## Contents

- extension.json: extension manifest and tool binding.
- skills/scene-auditor.md: skill instructions.

## Expected behavior

The skill reviews a mapping project and returns a report. It requests only mapping.view, uses only the registered mapping.inspect implementation, and has no outbound network access.

The example is a schema and workflow reference. It is not installable until a SAMP.AI runtime, registry, adapter, and permission implementation are available.
