# Triage Labels

The vault has no labels: a triage role is the task's `status`, plus a line in the body where the status alone is ambiguous.

| Label in mattpocock/skills | In the vault                                                                 | Meaning                                  |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| `needs-triage`             | `status: todo`                                                               | I need to evaluate it                    |
| `needs-info`               | `status: blocked`, the question in `blocked_by` and under `## Questions`     | Waiting on me for more information       |
| `ready-for-agent`          | `status: todo`                                                               | Fully specified: I can start autopilot   |
| `ready-for-human`          | `status: todo` with a `Ready for human: <why>` line at the top of the body   | Needs me to do it                        |
| `wontfix`                  | `status: done` with a `Won't fix: <why>` line at the top of the body         | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), set the status from this table.
