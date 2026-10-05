import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { xeroClient } from "../../clients/xero-client.js";
import { recodeContext } from "../../recoding/context.js";

export default CreateXeroTool(
  "apply-bank-recode",
  "Apply an explicitly approved exact account coding preview once. Requires its tenant, proposalId, approvalHash and confirmed=true. Never retry unknown/drift outcomes; inspect the transaction and statement match. Does not change tax, amounts or line structure.",
  { proposalId: z.string().uuid(), approvalHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true) },
  async ({ proposalId, approvalHash, confirmed }) => {
    const authority = recodeContext();
    const receipt = await authority.service.apply(authority, xeroClient.tenantId, proposalId, approvalHash, confirmed);
    return { isError: receipt.outcome !== "applied", structuredContent: receipt, content: [{ type: "text", text: JSON.stringify(receipt) }] };
  },
);
