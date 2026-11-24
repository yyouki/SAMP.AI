# Self-Expanding Skills

## 1. Purpose

SAMP.AI should recognize when a workflow is missing, design a candidate skill, test it against controlled examples, and propose it for installation. This lets the assistant grow beyond the initial mapping and TextDraw domains.

**Self-expansion means the AI can prepare and validate new skill packages. It does not mean the model can grant itself permissions, inject code into the running core, or activate arbitrary tools.**

The first extension format is declarative: a package contains metadata and instruction files that orchestrate already registered tools. New executable tool implementations require a separate reviewed code contribution to the core or an adapter.

## 2. Terms

- **Skill:** a domain workflow and instruction set for the agent.
- **Tool:** a typed operation exposed by the core or an adapter.
- **Tool binding:** a declaration that lets an extension refer to an existing registered implementation.
- **Adapter capability:** a feature an installed adapter explicitly reports as supported.
- **Extension:** a versioned package containing one or more skills and their declarations.
- **Generated candidate:** an extension package prepared by the AI but not yet trusted or enabled.

## 3. Self-expansion lifecycle

1. User request or permitted event reveals a workflow gap.
2. The agent checks installed skills, tool registry, and adapter capabilities.
3. It explains the missing capability and proposes a skill scope.
4. It generates a declarative candidate package.
5. The validator checks schemas, paths, tool references, permissions, capabilities, and resource limits.
6. An evaluation runner tests the skill against mock tool responses and adversarial inputs.
7. The AI presents a package diff, requested permissions, test report, and limitations.
8. A maintainer reviews the package and explicitly approves it for installation.
9. The server owner enables the extension and grants the allowed permissions.
10. The runtime records use, failures, disablement, and rollback.

Every generated candidate starts disabled. A model response or successful test run is not an approval.

## 4. What the AI may generate in the first version

The initial package format supports declarative files only:
- extension manifest;
- skill instruction documents;
- examples and test fixtures;
- references to already registered tool implementations;
- documentation and evaluation reports.

The AI may not add a new executable tool implementation merely by writing a manifest entry. The implementation field in a tool binding must match a tool already registered by the core or an installed adapter. Unknown implementations must fail validation.

A new low-level operation—such as a new server native, filesystem integration, SQL operation, or deployment command—requires a code change in a trusted core/adapter repository, tests, review, and a new release.

## 5. Machine-readable package contract

The initial schemas live in:
- schemas/extensions/manifest.schema.json
- schemas/extensions/skill.schema.json
- schemas/extensions/tool.schema.json

A working example is in examples/extensions/scene-auditor/.

The manifest declares stable extension ID and semantic version, publisher and license metadata, core and protocol compatibility, skills and instruction file paths, tool bindings, requested permissions, required adapter capabilities, data categories accessed, outbound network requirements, and execution/context budgets.

Paths must be normalized and remain inside the extension package. Reject absolute paths, parent-directory traversal, symlinks escaping the package root, and files not included in the verified package.

## 6. Tool binding and authority

A skill may call only tools in its allowed-tools list. Each tool binding must refer to a pre-registered implementation and declare its effect, risk, permission requirements, adapter capabilities, input/output schemas, timeout, idempotency, and compensation strategy.

The gateway must independently verify:
1. The extension is installed and enabled.
2. The skill belongs to that installed extension.
3. The tool is listed in the skill allowlist.
4. The implementation exists and is enabled.
5. The adapter advertises all required capabilities.
6. The current actor has the required permissions.
7. The action is permitted by the configured autonomy level.
8. Inputs pass schema and semantic validation.
9. Resource and rate limits are not exceeded.

An extension's requested permissions are a request, not a grant. Installing an extension does not automatically enable its skills, grant permissions, or allow outbound network access.

## 7. Test and review requirements

Before an extension can be enabled:
- Validate every JSON file against the correct JSON Schema.
- Resolve every referenced skill instruction file inside the package root.
- Resolve every tool binding against the registered tool catalog.
- Check that requested permissions cover, and do not exceed, the permissions used by tools.
- Check that required capabilities are available on the intended adapter.
- Check the network declaration against server policy.
- Run workflow tests with mocked tool responses.
- Include negative tests for denied permissions, unknown tools, missing capabilities, malformed inputs, and oversized outputs.
- Produce a human-readable report with package hash and schema versions.
- Require maintainer review for published community packages and explicit server-owner enablement.

A generated skill should be tested for prompt-injection resistance. Project files, map metadata, player-provided text, and tool results are untrusted data; they must not be treated as instructions that override the skill's policy or tool allowlist.

## 8. Execution model and future code extensions

**Initial release:** declarative skills only. Skill instructions are interpreted by the configured model, while all side effects go through existing typed tools and the permission gateway.

**Future, separately designed feature:** executable extensions may be considered only after a sandbox runtime and threat model exist. A possible direction is WASM or an isolated worker with no ambient filesystem/network access, explicit capability-based host calls, CPU/memory/time/output limits, immutable package hashes, signed releases and revocation, a dedicated security review, and no access to provider secrets or server credentials.

Do not implement a general-purpose plugin loader that runs arbitrary generated source code inside the AI Core process.

## 9. Versioning, trust, and rollback

- Use semantic versions for extension packages.
- A changed instruction file or tool binding creates a new package version and hash.
- Keep the previously installed version available for rollback.
- Record who generated, reviewed, installed, enabled, disabled, and updated each package.
- A permission change requires a fresh review and owner grant.
- A publisher signature can establish package origin, but it does not prove the package is safe.
- Support immediate disablement and revocation of an extension or individual skill.

## 10. Suggested user experience

Example interaction:

**Admin:** "I often need to check whether mapping projects contain duplicate props. Can you make a skill for that?"

**AI:** "I can prepare a read-only Scene Auditor skill using the existing mapping inspection tool. It will not modify objects. I will create a candidate package and run it against mock scene data. It will remain disabled until a maintainer reviews it and a server owner enables it."

The AI should show why it believes the skill is missing, the tools it plans to use, requested permissions and data access, test results and limitations, and a diff from the previous version when updating an existing skill.

## 11. Acceptance criteria

Self-expanding skills are ready for an MVP only when:
1. A skill candidate can be generated as a package without executing generated code.
2. Manifest and skill files validate against versioned schemas.
3. Unknown tool implementations are rejected.
4. Requested permissions never become grants automatically.
5. The candidate can be evaluated against mocked tools.
6. Installation and activation are separate, auditable actions.
7. A bad skill can be disabled and rolled back without affecting the core.
