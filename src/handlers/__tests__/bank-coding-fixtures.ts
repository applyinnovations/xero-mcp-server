import { Account, BankTransaction } from "xero-node";
export const tenantId = "11111111-1111-4111-8111-111111111111";
export const others = ["77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888"];
export const lineItemId = "44444444-4444-4444-8444-444444444444";
export const transaction = {
  bankTransactionID: "22222222-2222-4222-8222-222222222222", type: "SPEND", status: "AUTHORISED",
  isReconciled: true, currencyCode: "AUD", currencyRate: 1, lineAmountTypes: "Inclusive",
  reference: "Keep exact reference", date: "2026-01-01", updatedDateUTC: new Date("2026-01-02T00:00:00Z"), total: 0, totalTax: 0, subTotal: 0,
  contact: { contactID: "33333333-3333-4333-8333-333333333333" }, bankAccount: { accountID: "99999999-9999-4999-8999-999999999999" },
  lineItems: [{ lineItemID: lineItemId, accountCode: "400", taxType: "NONE", lineAmount: 0,
    taxAmount: 0, unitAmount: 0, quantity: 1, description: "fixture",
    tracking: [{ trackingCategoryID: "55555555-5555-4555-8555-555555555555", trackingOptionID: "66666666-6666-4666-8666-666666666666", name: "Region", option: "East" }] },
    { lineItemID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountCode: "300", taxType: "NONE", lineAmount: 0,
      taxAmount: 0, unitAmount: 0, quantity: 2, description: "untouched fixture", tracking: [] }],
} as unknown as BankTransaction;
export const accounts = [{ accountID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "500", status: "ACTIVE", type: "EXPENSE", taxType: "INPUT" }] as unknown as Account[];
export const changes = [{ lineItemId, accountCode: "500" }];
