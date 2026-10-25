# 2.20.20 — classify RCC operations without rejecting local names

The 2.20.19 guard searched every argument for `cloud`, `credentials` or
`feedback`. That incorrectly blocked local profile names, paths and Holotree
space names. It also missed the published CLI aliases `c`, `robocorp` and `f`.

The guard now parses only the command prefix. RCC 18.19.7 help supplies the
global/configuration flag arities and aliases. Global flag values are consumed;
the parser stops at the root operation, or the configuration subcommand. Leaf
profile/space/path values remain RCC arguments. Cloud, feedback and configuration
credentials are default-off regardless of aliases or leading global flags.
Unrecognized prefix flags fail before executable lookup instead of guessing
their arity. Native typed callers already place leaf flags after the command.

Credential-home routing uses the same normalized operation. Explicit legacy
configuration remains necessary for external operations. Gallery/Vault policy,
owned Action SDK selection and managed schema checks are unchanged.

Regression coverage includes all three reserved words as profile and space
names, values of leading flags, configuration aliases, cloud/feedback aliases,
global booleans, missing flag values and ambiguous prefixes. The new
`sema4ai/tests/rcc_operation_smoke.py` exercises real installed profile operations
in a new task-owned home, then named spaces with `--no-build` in an explicitly
supplied task cache. Vendor-operation checks stop before executable lookup.
No external endpoint, owner profile or network/security setting is changed.

Local tests: 161 Node, 106 selected Python passed; one previously documented
workflow-retirement test remains skipped pending approval. Exact installed
payload, executable receipts and candidate hashes are in the QA packet.
Native desktop acceptance is separate. Preserve earlier artifacts; do not use
2.20.19 screenshots to qualify 2.20.20.

All [2.20.19 release holds](owned-boundaries-2.20.19.md) remain. In particular,
the denied hosted workflow change has not been retried or edited. No merge,
hosted CI, publication, upstream edit or dependency resolution change is part
of this correction.
