import { xeroClient } from "../clients/xero-client.js";
import { BankTransaction } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

async function getBankTransactions(
  page: number,
  bankAccountId?: string,
  pageSize: number = 100,
  type?: "SPEND" | "RECEIVE",
  reconciledOnly: boolean = true,
): Promise<BankTransaction[]> {
  await xeroClient.authenticate();

  const filters = [type ? `Type=="${type}"` : '(Type=="SPEND" OR Type=="RECEIVE")'];
  if (bankAccountId) filters.push(`BankAccount.AccountID==guid("${bankAccountId}")`);
  if (reconciledOnly) filters.push("IsReconciled==true");

  const response = await xeroClient.accountingApi.getBankTransactions(xeroClient.tenantId,
      undefined, // ifModifiedSince
      filters.join(" AND "), // where
      "Date DESC", // order
      page, // page
      4, // unitdp
      pageSize, // pagesize
      getClientHeaders()
  );

  return response.body.bankTransactions ?? [];
}

export async function listXeroBankTransactions(
  page: number = 1,
  bankAccountId?: string,
  pageSize: number = 100,
  type?: "SPEND" | "RECEIVE",
  reconciledOnly: boolean = true,
): Promise<XeroClientResponse<BankTransaction[]>> {
  try {
    const bankTransactions = await getBankTransactions(page, bankAccountId, pageSize, type, reconciledOnly);

    return {
      result: bankTransactions,
      isError: false,
      error: null
    }
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error)
    }
  }
}