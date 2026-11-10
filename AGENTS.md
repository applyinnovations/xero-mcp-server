# Repository instructions

Do not commit agent working notes, journals, progress logs, or session-specific plans and status reports. Keep working notes outside the repository; commit only durable project documentation.

Features must integrate with the whole system through existing shared abstractions and repository conventions. Do not add parallel feature-specific authentication, token/state storage, permissions or configuration when shared facilities already cover the need. Keep domain-specific validation and behavior in the domain layer.

## CI

CI is Tekton Pipelines-as-Code on xlab (`.tekton/`) and follows the xlab CI
scripting standard ([Repository pipelines](https://github.com/applyinnovations/deployments/blob/main/clusters/xlab/manifests/tekton/README.md#repository-pipelines)): pipelines only wire Tasks
and call scripts in this repository, which hold the logic, run the same
locally and have tests (Bash for glue, Python for real logic). No inline logic
in YAML.
