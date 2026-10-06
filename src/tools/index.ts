import type { ToolBuilder } from "../types/tool-definition.js";
import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";
import { ConnectionTools } from "./onboarding.js";

// Only supported tools belong in these exports; legacy implementations remain unregistered.
export const SupportedTools: readonly ToolBuilder[] = [
  ...GetTools, ...ListTools, ...CreateTools, ...UpdateTools, ...DeleteTools, ...ConnectionTools,
];
