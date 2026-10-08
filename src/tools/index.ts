import type { ToolBuilder } from "../types/tool-definition.js";
import { CreateTools } from "./create/index.js";
import { DeleteTools } from "./delete/index.js";
import { GetTools } from "./get/index.js";
import { ListTools } from "./list/index.js";
import { UpdateTools } from "./update/index.js";
import { ConnectionTools } from "./onboarding.js";

import { selectPayrollModule, type PayrollModule } from "../payroll/module.js";

// Selected regional inventory; entrypoints select tools using shared resource/access permissions.
export const ToolCatalog = (
  payroll: PayrollModule = selectPayrollModule(),
): readonly ToolBuilder[] => [
  ...GetTools,
  ...ListTools,
  ...CreateTools,
  ...UpdateTools,
  ...DeleteTools,
  ...ConnectionTools,
  ...payroll.tools,
];
