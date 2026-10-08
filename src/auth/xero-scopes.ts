// Scope resources and read/write alternatives follow Xero's public scope catalogue:
// https://developer.xero.com/documentation/guides/oauth2/scopes/
export const supportedToolConsentScopes = [
  "offline_access", "accounting.invoices", "accounting.payments", "accounting.banktransactions",
  "accounting.manualjournals", "accounting.contacts", "accounting.settings",
  "accounting.reports.aged.read", "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read", "accounting.reports.trialbalance.read",
  "payroll.employees.read", "payroll.settings.read", "payroll.timesheets",
] as const;

const transactionScopes = new Set(["accounting.invoices", "accounting.payments", "accounting.banktransactions", "accounting.manualjournals"]);
const reportScopes = new Set<string>(supportedToolConsentScopes.filter(scope => scope.startsWith("accounting.reports.")));

/** Documented alternatives; read-only consent never satisfies a write requirement. */
export function compatibleXeroScopes(required: string): string[] {
  if (reportScopes.has(required)) return [required, "accounting.reports.read"];
  const read = required.endsWith(".read"), base = read ? required.slice(0, -5) : required;
  const choices = read ? [required, base] : [required];
  if (transactionScopes.has(base)) choices.push(...(read ? ["accounting.transactions.read", "accounting.transactions"] : ["accounting.transactions"]));
  return choices;
}

export function missingXeroConsent(options: readonly string[]): Error {
  return new Error(`Xero OAuth consent is missing for this endpoint. Requires one of: ${options.join(", ")}. Token refresh cannot add scopes; request owner-approved consent renewal before retrying.`);
}

/** Relative SDK endpoint paths, including indirect reads within mutation handlers. */
export function xeroEndpointScopeOptions(domain: "accounting" | "payrollNZ" | "payrollAU", path: string, read: boolean): string[] | undefined {
  const [resource, report] = path.split("/").filter(Boolean);
  let base: string | undefined;
  if (domain === "payrollNZ") {
    base = ({ Employees: "payroll.employees", LeaveTypes: "payroll.settings", Timesheets: "payroll.timesheets" } as Record<string, string>)[resource];
  } else if (domain === "payrollAU") {
    base = ({ Employees: "payroll.employees", PayItems: "payroll.settings", Timesheets: "payroll.timesheets" } as Record<string, string>)[resource];
  } else {
    if (resource === "Items") return ["accounting.invoices", "accounting.settings"].flatMap(scope => read ? [`${scope}.read`, scope] : [scope]);
    if (resource === "Reports") {
      const scope = ({ AgedPayablesByContact: "accounting.reports.aged.read", AgedReceivablesByContact: "accounting.reports.aged.read",
        BalanceSheet: "accounting.reports.balancesheet.read", ProfitAndLoss: "accounting.reports.profitandloss.read",
        TrialBalance: "accounting.reports.trialbalance.read" } as Record<string, string>)[report];
      return read && scope ? compatibleXeroScopes(scope) : undefined;
    }
    base = ({ Invoices: "accounting.invoices", CreditNotes: "accounting.invoices", Quotes: "accounting.invoices",
      Payments: "accounting.payments", BankTransactions: "accounting.banktransactions", ManualJournals: "accounting.manualjournals",
      Contacts: "accounting.contacts", ContactGroups: "accounting.contacts", Accounts: "accounting.settings",
      Organisation: "accounting.settings", Organisations: "accounting.settings", TaxRates: "accounting.settings",
      TrackingCategories: "accounting.settings" } as Record<string, string>)[resource];
  }
  return base ? compatibleXeroScopes(read ? `${base}.read` : base) : undefined;
}

export function assertXeroEndpointConsent(domain: "accounting" | "payrollNZ" | "payrollAU", path: string, read: boolean, scope: string | undefined): void {
  // Legacy static bearer configuration supplies no scope metadata. Let Xero decide
  // in that case; its scope rejection is formatted distinctly from expired tokens.
  if (scope === undefined) return;
  const options = xeroEndpointScopeOptions(domain, path, read);
  if (options && !options.some(option => scope.split(/\s+/).includes(option))) throw missingXeroConsent(options);
}
