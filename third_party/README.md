# HSW Third-Party Inputs

This directory is for local third-party source trees that Hoshi Reader Windows may build against.

`hoshidicts` is expected at:

```text
third_party/hoshidicts
```

HSW may compile and link against this local tree for dictionary backend work, but the `hoshidicts` source itself is not vendored into this repository and should not be edited here. Use `HSW_HOSHIDICTS_DIR` to point the build to a different local checkout when needed.
