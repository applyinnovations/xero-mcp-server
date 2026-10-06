import { z } from "zod";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { updateXeroTrackingCategory } from "../../handlers/update-xero-tracking-category.handler.js";

const UpdateTrackingCategoryTool = CreateXeroTool({
  name: "update-tracking-category",
  description: `Updates an existing tracking category in Xero.`,
  access: "write",
  schema: {
    trackingCategoryId: z.string(),
    name: z.string().optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional()
  },
  handler: async ({ trackingCategoryId, name, status }) => {
    const response = await updateXeroTrackingCategory(trackingCategoryId, name, status);

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error while updating tracking category: ${response.error}`
          }
        ]
      };
    }

    const trackingCategory = response.result;
    
    return {
      content: [
        {
          type: "text" as const,
          text: `Updated the tracking category "${trackingCategory.name}" (${trackingCategory.trackingCategoryID}).`
        },
      ]
    };
  },
});

export default UpdateTrackingCategoryTool;