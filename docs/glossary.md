# Glossary

| Term | Meaning |
| --- | --- |
| **Req0** | This product: packs, compiler, cockpit, and later Jev + coding-agent + proof layers. Requirement at origin — the spec is the source of truth. |
| **Jev** | TypeSafe System One. A decision model: typed `noul` (yes/no probability), `choice`, and `score` about a `state`. It does not generate code or prose. |
| **Requirement pack** | A folder under `docs/requirements/<id>/` with `requirement.md` and fixtures. |
| **Requirement Owner (RO)** | Person accountable for a requirement through definition, build kickoff, and proof. |
| **Cockpit** | Local UI from `req0 start`. Orientation, health, next action. |
| **Spec Valid** | Grammar compiled with no errors. Not the same as “ready for an agent.” |
| **Ready** | Quality gate. Blocked by missing personas, untestable rules, matrix contradictions, or pack noul below **0.75**. No API key → Not yet. |
| **Build** | Coding-agent run finished (Milestone 3). Not “the app boots.” Stale if the spec changes after a run. |
| **Proof** | Browser QA against the compiled qa-plan (Milestone 4). States: Not yet / Passed / Failed / Needs review / Stale. |
| **Observable** | On a business rule: what a person or test could notice. |
| **Persona** | Test user for a matrix role. Never a production account. |
| **Coding-agent adapter** | Thin launcher around a portable implement brief. Cursor is the first adapter, not the product. |
| **Fence** | A locked decision to stop the project becoming a second product. |
