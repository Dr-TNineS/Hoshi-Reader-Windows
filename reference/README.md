# HSW Reference Projects

This directory contains read-only upstream reference projects used while
developing Hoshi Reader Windows.

Tracked submodules:

- `Hoshi-Reader-Android`: primary reference for HSA user-visible behavior.
- `hoshi-reader-mac`: supplemental reference for HSM user-visible behavior.
- `ttu/ebook-reader`: supplemental reference for TTU reader behavior.

Initialize them after a fresh clone with:

```text
git submodule update --init --recursive
```

Existing worktrees can run the same command from the HSW root to populate
missing reference projects. To update the pinned upstream commits, fetch inside
the relevant submodule, check out the intended commit, then commit the changed
gitlink and `.gitmodules` change in HSW if needed.

Treat these submodules as read-only behavior references. Do not modify reference
project code, commit their local build outputs, or add other reference projects
unless a task explicitly expands the long-term reference scope. Ad hoc local
reference checkouts under `reference/` remain ignored by HSW.
