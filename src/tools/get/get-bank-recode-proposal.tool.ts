import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { xeroClient } from "../../clients/xero-client.js";
import { bankRecodeChangesSchema } from "../../recoding/bank-recode-proposal.js";
import { recodeContext } from "../../recoding/context.js";

export default CreateXeroTool(
  "get-bank-recode-proposal",
  "Dry-run account coding preview for existing authorised SPEND/RECEIVE transactions, reconciled or unreconciled. Preserves descriptions, references, line IDs, tracking, tax, currency and totals. Review the exact diff before explicitly applying; excludes raw bank-feed lines.",
  { bankTransactionId: z.string().uuid(), changes: bankRecodeChangesSchema },
  async ({ bankTransactionId, changes }) => {
    const authority = recodeContext();
    const proposal = await authority.service.preview(authority, xeroClient.tenantId, bankTransactionId, changes);
    return { structuredContent: proposal, content: [{ type: "text", text: JSON.stringify(proposal) }] };
  },
);
