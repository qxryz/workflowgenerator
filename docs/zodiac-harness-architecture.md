# Zodiac Harness Architecture

## Product contract

Zodiac is the orchestration layer of WorkflowGenerator. It has four jobs:

1. turn an intent into an editable workflow;
2. guide a person through a workflow without hiding decisions;
3. execute only after an explicit user request or confirmation;
4. turn a successful method into a reusable Skill.

The canvas remains the source of truth. Chat messages can propose or explain operations, but a workflow is not changed until structured operations are accepted and applied.

## Interaction loop

The useful behavior in Open Design is not tied to one coding-agent vendor. It comes from a productized loop:

1. **Understand** — read the brief, canvas selection, connected inputs, active Skills, and available models or terminal tools.
2. **Clarify** — ask one blocking question only when the answer changes the result materially.
3. **Plan** — expose a short sequence with checkpoints.
4. **Propose** — emit typed canvas operations, never free-form claims that the canvas changed.
5. **Run** — stream reasoning visibility, status, tool calls, artifacts, and failures as separate events.
6. **Review** — check output types, connections, declared outputs, and final assets.
7. **Continue** — offer concrete next actions such as edit, retry, branch, run downstream, or save as Skill.

Open Design separates its system prompt into layered concerns and normalizes several agent runtimes behind one run lifecycle. Zodiac should retain that separation instead of growing one monolithic prompt.

## Harness layers

Prompt priority, from highest to lowest:

1. user request and safety boundaries;
2. canvas data contract and operation schema;
3. current workspace snapshot and selected nodes;
4. active Skills in user-defined order;
5. Zodiac collaboration style;
6. provider-specific formatting hints.

Runtime components:

- **Intent gateway** classifies discuss, plan, edit, execute, inspect, and distill-to-skill intents.
- **Context assembler** builds a bounded canvas snapshot and resolves direct upstream assets.
- **Planner** produces a visible task sequence and confirmation points.
- **Tool broker** validates typed operations before they reach the canvas.
- **Run ledger** persists status, stream events, tool events, artifacts, cancellation, and retry lineage.
- **Artifact router** commits one result to one destination according to workflow topology.
- **Skill runtime** loads only enabled packages in stable priority order.
- **Skill distiller** turns an approved successful run into an editable Skill draft with provenance.

## One canvas, two valid workflow styles

WorkflowGenerator does not need a global “operational versus preconfigured” switch. Topology already expresses the user’s intent.

### Prepared workflow

An action node connected to a compatible empty asset node declares that node as its output slot:

```text
prompt → image generation → image output → video generation → video output
```

Running the image generation step updates `image output`. It must not create a second image node. Re-running updates the same slot; versions belong in asset history.

### Exploratory work

If an action node has no compatible downstream output slot, its result is a new branch asset placed near the action node and connected to its source.

```text
prompt → image generation → new exploratory image
```

The user can keep it as a branch, replace it, or connect/promote it into the prepared workflow.

### Invariant

For one result, the artifact router must choose exactly one:

- update a declared compatible output slot; or
- create a new exploratory asset.

It must never do both.

## Skills

### Package shape

The portable core is a UTF-8 `SKILL.md`. Registry metadata supplies:

- stable id and semantic version;
- name, description, tags, capabilities;
- content URL and SHA-256 checksum;
- homepage, license, provenance, and compatibility;
- optional declared inputs and outputs.

The registry is a signed or checksum-verified index. Skill content is treated as untrusted instructions until the user installs and enables it.

### App-owned storage

Installed packages and enablement live in WorkflowGenerator’s native application data. They are not written to `~/.agent`, `~/.codex`, or another agent’s global directory.

When WorkflowGenerator opens an embedded terminal node, it materializes enabled Skills into that terminal session’s private workspace and exposes:

- `WG_SKILLS_DIR`
- `WG_SKILLS_INDEX`
- `WG_ACTIVE_SKILLS`

This makes the same package readable by any CLI launched inside that terminal without mutating global configuration. Automatic consumption still depends on the CLI: WorkflowGenerator should inject a bootstrap instruction or provide a future `wg skills`/MCP bridge for agents that do not inspect environment variables themselves.

### Zodiac use

Zodiac receives enabled Skill bodies as a separate prompt layer. Multiple Skills can be active at once and their order is user-controlled. Canvas contracts and explicit user instructions override Skill instructions.

### Distilling a Skill

“Save as Skill” should create a draft, not silently publish it. The draft should contain:

- when to use it;
- required inputs;
- the stable sequence and decision points;
- expected outputs and validation;
- tools/models used as preferences rather than hard requirements;
- provenance linking back to the successful run.

The user reviews the draft before it becomes installed or is published to the repository.

## Distribution

Default registry:

```text
https://raw.githubusercontent.com/qxryz/workflowgenerator/skills-dist/official-skills.json
```

Recommended branch contents:

```text
official-skills.json
workflow-architect.md
creative-director.md
```

Release automation should validate ids, semantic versions, HTTPS URLs, checksums, license/provenance, and Markdown size before updating `official-skills.json`.

## Open Design references

- Prompt composition: `apps/daemon/src/prompts/system.ts`
- Official collaboration loop: `apps/daemon/src/prompts/official-system.ts`
- Run lifecycle: `apps/daemon/src/runtimes/`
- Skill storage and validation: `apps/daemon/src/skills.ts`
- Portable agent-skill adapter: `packages/plugin-runtime/src/adapters/agent-skill.ts`
- Session UI: `apps/web/src/components/ChatPane.tsx`, `AssistantMessage.tsx`, `QuestionForm.tsx`, and `NextStepActions.tsx`
