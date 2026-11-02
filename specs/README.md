# Specifications

This project follows Spec-Driven Development (SDD). Each feature lives in its own
numbered directory and is documented before it is implemented.

## Feature layout

```
specs/
└── NNN-feature-name/
    ├── spec.md    # Requirements and acceptance criteria
    ├── plan.md    # Architecture, algorithms and technical decisions
    └── tasks.md   # Implementation and validation tasks
```

## Planned features

| ID  | Directory                    | Status      |
| --- | ---------------------------- | ----------- |
| 001 | `001-dataset-processing/`    | Implemented |
| 002 | `002-encounter-detection/`   | Implemented |
| 003 | `003-spatial-optimization/`  | Implemented |
| 004 | `004-output-validation/`     | Implemented (in review) |

Feature directories are created when their `spec.md` is written.
