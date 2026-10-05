# Xero MCP Server

This is a Model Context Protocol (MCP) server implementation for Xero. It provides a bridge between the MCP protocol and Xero's API, allowing for standardized access to Xero's accounting and business features.

## Features

- Xero OAuth2 authentication with custom connections
- Contact management
- Chart of Accounts management
- Invoice creation and management
- MCP protocol compliance

## Prerequisites

- Node.js 24.21.0 LTS (see `.nvmrc`)
- npm 11.19.x (bundled with the pinned Node runtime)
- A Xero developer account with API credentials

## Docs and Links

- [Xero Public API Documentation](https://developer.xero.com/documentation/api/)
- [Xero API Explorer](https://api-explorer.xero.com/)
- [Xero OpenAPI Specs](https://github.com/XeroAPI/Xero-OpenAPI)
- [Xero-Node Public API SDK Docs](https://xeroapi.github.io/xero-node/accounting)
- [Developer Documentation](https://developer.xero.com/)

## Setup

### Create a Xero Account

If you don't already have a Xero account and organisation already, can create one by signing up [here](https://www.xero.com/au/signup/) using the free trial.

We recommend using a Demo Company to start with because it comes with some pre-loaded sample data. Once you are logged in, switch to it by using the top left-hand dropdown and selecting "Demo Company". You can reset the data on a Demo Company, or change the country, at any time by using the top left-hand dropdown and navigating to [My Xero](https://my.xero.com).

NOTE: To use Payroll-specific queries, the region should be either NZ or UK.

### Authentication

There are 2 modes of authentication supported in the Xero MCP server:

#### 1. Custom Connections

This is a better choice for testing and development which allows you to specify client id and secrets for a specific organisation.
It is also the recommended approach if you are integrating this into 3rd party MCP clients such as Claude Desktop.

##### Configuring your Xero Developer account

Set up a Custom Connection following these instructions: https://developer.xero.com/documentation/guides/oauth2/custom-connections/

##### Required Scopes

Custom connections require different scopes depending on when they were created. **All scopes in the relevant list must be added to your custom connection:**

| Custom Connection Created | Required Scopes |
|---------------------------|-----------------|
| Before Apr 29, 2026 | [SCOPES_V1](src/clients/xero-client.ts#L82-L90) (bundled permissions) |
| From Apr 29, 2026 | [SCOPES_V2](src/clients/xero-client.ts#L93-L112) (granular permissions) |

> **Note:** The MCP server automatically tries V1 scopes first and falls back to V2 if needed.
> 
> You can override these by setting the `XERO_SCOPES` environment variable to a space-separated list of scopes.

##### Integrating the MCP server with Claude Desktop

To add the MCP server to Claude go to Settings > Developer > Edit config and add the following to your claude_desktop_config.json file:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_SCOPES": "accounting.invoices accounting.contacts accounting.settings"
      }
    }
  }
}
```

The `XERO_SCOPES` variable is optional. If omitted, the default scopes listed above will be used.

NOTE: If you are using [Node Version Manager](https://github.com/nvm-sh/nvm) `"command": "npx"` section change it to be the full path to the executable, ie: `your_home_directory/.nvm/versions/node/v22.14.0/bin/npx` on Mac / Linux or `"your_home_directory\\.nvm\\versions\\node\\v22.14.0\\bin\\npx"` on Windows

#### 2. Bearer Token

This is a better choice if you are to support multiple Xero accounts at runtime and allow the MCP client to execute an auth flow (such as PKCE) as required.
In this case, use the following configuration:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_BEARER_TOKEN": "your_bearer_token"
      }
    }
  }
}
```

NOTE: The `XERO_CLIENT_BEARER_TOKEN` will take precedence over the `XERO_CLIENT_ID` if defined.

##### Required Scopes for Bearer Token

When obtaining a bearer token, you must request the appropriate scopes. The scopes you request should be:

> **Note:** Some scopes are being deprecated in favour of more granular scopes. See the [Xero OAuth 2.0 Scopes documentation](https://developer.xero.com/documentation/guides/oauth2/scopes/) for details on deprecation timelines.

```
accounting.transactions (Deprecated)
accounting.transactions.read (Deprecated)
accounting.invoices
accounting.invoices.read
accounting.payments
accounting.payments.read
accounting.banktransactions
accounting.banktransactions.read
accounting.manualjournals
accounting.manualjournals.read
accounting.reports.read (Deprecated)
accounting.reports.aged.read
accounting.reports.balancesheet.read
accounting.reports.profitandloss.read
accounting.reports.trialbalance.read
accounting.contacts 
accounting.settings 
payroll.settings 
payroll.employees 
payroll.timesheets
```


### Available MCP Commands

- `list-accounts`: Retrieve a list of accounts
- `list-contacts`: Retrieve a list of contacts from Xero
- `list-credit-notes`: Retrieve a list of credit notes
- `list-invoices`: Retrieve a list of invoices
- `list-items`: Retrieve a list of items
- `list-manual-journals`: Retrieve a list of manual journals
- `list-organisation-details`: Retrieve details about an organisation
- `list-profit-and-loss`: Retrieve a profit and loss report
- `list-quotes`: Retrieve a list of quotes
- `list-tax-rates`: Retrieve a list of tax rates
- `list-payments`: Retrieve a list of payments
- `list-trial-balance`: Retrieve a trial balance report
- `list-bank-transactions`: Retrieve a list of bank account transactions
- `list-payroll-employees`: Retrieve a list of Payroll Employees
- `list-report-balance-sheet`: Retrieve a balance sheet report
- `list-payroll-employee-leave`: Retrieve a Payroll Employee's leave records
- `list-payroll-employee-leave-balances`: Retrieve a Payroll Employee's leave balances
- `list-payroll-employee-leave-types`: Retrieve a list of Payroll leave types
- `list-payroll-leave-periods`: Retrieve a list of a Payroll Employee's leave periods
- `list-payroll-leave-types`: Retrieve a list of all available leave types in Xero Payroll
- `list-timesheets`: Retrieve a list of Payroll Timesheets
- `list-aged-receivables-by-contact`: Retrieves aged receivables for a contact
- `list-aged-payables-by-contact`: Retrieves aged payables for a contact
- `list-contact-groups`: Retrieve a list of contact groups
- `list-tracking-categories`: Retrieve a list of tracking categories
- `create-bank-transaction`: Create a new bank transaction
- `create-contact`: Create a new contact
- `create-credit-note`: Create a new credit note
- `create-invoice`: Create a new invoice
- `create-item`: Create a new item
- `create-manual-journal`: Create a new manual journal
- `create-payment`: Create a new payment
- `create-quote`: Create a new quote
- `create-payroll-timesheet`: Create a new Payroll Timesheet
- `create-tracking-category`: Create a new tracking category
- `create-tracking-option`: Create a new tracking option
- `update-bank-transaction`: Update an existing bank transaction
- `update-contact`: Update an existing contact
- `update-invoice`: Update an existing draft invoice
- `update-item`: Update an existing item
- `update-manual-journal`: Update an existing manual journal
- `update-quote`: Update an existing draft quote
- `update-credit-note`: Update an existing draft credit note
- `update-tracking-category`: Update an existing tracking category
- `update-tracking-options`: Update tracking options
- `update-payroll-timesheet-line`: Update a line on an existing Payroll Timesheet
- `approve-payroll-timesheet`: Approve a Payroll Timesheet
- `revert-payroll-timesheet`: Revert an approved Payroll Timesheet
- `add-payroll-timesheet-line`: Add new line on an existing Payroll Timesheet
- `delete-payroll-timesheet`: Delete an existing Payroll Timesheet
- `get-payroll-timesheet`: Retrieve an existing Payroll Timesheet

For detailed API documentation, please refer to the [MCP Protocol Specification](https://modelcontextprotocol.io/).

## For Developers

### Installation

```bash
nvm install
nvm use
npm ci
```

Use the committed lockfile for clean installs. Update it with the supported
Node/npm toolchain when changing dependencies; do not regenerate it to work
around an unsupported runtime.

### Run a build

```bash
npm run build
npm test
```

### Local container image

```bash
docker build -t xero-mcp-server:local .
```

The multistage build pins the official Node 24 LTS image by digest, runs the build
and tests, and installs only production dependencies in the final image. It runs
as the `node` user and includes the original MIT license. The build context uses
an allowlist; `.env` files, Git history, dependencies and unrelated local files
are excluded. The container uses the existing stdio transport by default. Authenticated HTTP
mode is opt-in and described below.

Pass credentials only at runtime using an environment file kept outside the
build context:

```bash
docker run --rm -i --env-file /absolute/path/to/xero-runtime.env xero-mcp-server:local
```

For a startup check without Xero access, send an MCP initialization request with
an invalid placeholder token and networking disabled. This verifies startup
only; it does not call an accounting tool:

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"packaging-smoke","version":"1.0.0"}}}' \
  | docker run --rm -i --network none \
      -e XERO_CLIENT_BEARER_TOKEN=invalid-packaging-smoke-token xero-mcp-server:local
```

### Integrating with Claude Desktop

To link your Xero MCP server in development to Claude Desktop go to Settings > Developer > Edit config and add the following to your `claude_desktop_config.json` file:

NOTE: For Windows ensure the `args` path escapes the `\` between folders ie. `"C:\\projects\xero-mcp-server\\dist\\index.js"`

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["insert-your-file-path-here/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here"
      }
    }
  }
}
```

## License

MIT

## Security

Please do not commit your `.env` file or any sensitive credentials to version control (it is included in `.gitignore` as a safe default.)

## Explicit organisations and structured bank reads

This fork requires `XERO_ALLOWED_TENANT_IDS` to list the connected tenant UUIDs
allowed by the server. `list-tenants` returns the intersection of that allowlist
and the organisations connected to the Xero grant. Every accounting tool requires
an explicit `tenantId`; a missing, unallowed or disconnected selection fails
instead of choosing the first organisation. Each invocation has its own client
and organisation cache, so simultaneous calls cannot change each other's tenant.

`list-bank-transactions` returns full SDK records as structured MCP content and
JSON text, including zero amounts, transaction/line IDs and nested tracking. It
reads SPEND/RECEIVE only, defaults to reconciled transactions, and supports
`bankAccountId`, `type`, `page` and `pageSize` (1–100). Continue paging while
`pagination.mayHaveMore` is true; the final full page may require an empty follow-up
page. Concurrent changes can affect pagination, so it is not a snapshot export.
`get-bank-transaction` retrieves one full SPEND/RECEIVE record by ID.

Write tools are not registered. Enabling recoding requires later approval and a
Demo Company test proving that the original statement-line match survives an
in-place update, along with unchanged transaction/line IDs, tracking not selected
for change, tax, currency and totals. An `isReconciled` flag alone is insufficient.

## Durable OAuth refresh

For an existing approved authorization-code/PKCE grant, set `XERO_CLIENT_ID`,
`XERO_TOKEN_FILE` and `XERO_TOKEN_KEY_FILE` to an absolute encrypted-state path and
an absolute private key-file path. Confidential clients also set
`XERO_CLIENT_SECRET`; PKCE clients omit it. Do not combine this mode with the
static `XERO_CLIENT_BEARER_TOKEN` mode. No consent flow or grant is created by the
server.

The operator provisions a separate base64-encoded 32-byte encryption key through
their secret-management process. Key and state files must be regular files with
mode 0600, and their directory should be private (0700). Keep the key outside the
state volume and both outside the source/build context. Mount the state directory
writable by the container's UID 1000 and the key read-only. Back up state and key
separately; encrypted state alone cannot restore access.

After an approved grant is obtained separately, import its token set through
standard input with `node dist/auth/import-token.js` (or `npm run import-xero-token`
after building). Input is JSON containing `access_token`, `refresh_token`, absolute
Unix-seconds `expires_at`, and optionally `scope`. The importer refuses to replace
existing state and never prints tokens. No keys or grants are generated by this
utility. Renewal requires stopping all instances, completing a separately
approved authorization, and moving old state aside before importing new state.

Refreshes are serialized across providers/processes sharing one local filesystem
and grant. AES-256-GCM binds state to the client ID. The new token set is persisted
by atomic replacement with file/directory sync before an access token is returned.
Transient failures preserve the prior token for a later retry; `invalid_grant`
records that authorization needs renewal and prevents repeated refresh attempts.
Xero access tokens expire after 30 minutes; rotating refresh tokens must be saved,
and unused refresh tokens expire after 60 days. See
[Xero token documentation](https://developer.xero.com/documentation/guides/oauth2/token-types/).

This store is for one grant on a single host/local filesystem, not distributed
replicas or network filesystems. A crash during refresh may leave a `.lock`
directory. Requests fail closed after a bounded wait; an operator must establish
that no process owns the lock before removing it. Errors exposed through MCP are
redacted. Live refresh/revocation testing remains subject to approved Demo Company
access; tests use only synthetic token sets and mocked HTTP responses.

## Authenticated remote MCP with Keycloak

Select `MCP_TRANSPORT=http` only when preparing an authenticated remote service.
HTTP mode requires the durable OAuth configuration above and an explicit server
`XERO_ALLOWED_TENANT_IDS` allowlist. The default bind is `127.0.0.1:3000`; set
`MCP_HOST`/`MCP_PORT` for the intended network only during an approved deployment.
Production traffic must use a TLS reverse proxy. This PR provides no deployment
or realm configuration changes.

Required settings:

- `MCP_KEYCLOAK_ISSUER`: exact HTTPS Keycloak realm issuer, without a trailing slash.
- `MCP_RESOURCE_URL`: public HTTPS endpoint ending in `/mcp`.
- `MCP_AUDIENCE`: dedicated token audience for this MCP resource; defaults to its
  public endpoint URL. Keycloak tokens must include that audience.
- `MCP_READ_SCOPE`: required access-token scope, default `xero:read`.
- `MCP_SUBJECT_TENANTS_JSON`: JSON mapping exact Keycloak subject IDs to arrays of
  authorized tenant UUIDs. Subjects absent from this mapping are denied.

The server intersects subject permissions with its tenant allowlist and the
organisations connected to the Xero grant. An authenticated subject cannot select
another subject's tenant. The grant is server-managed; Keycloak tokens are never
forwarded to Xero. Different POST requests get separate MCP servers and client
contexts. Write tools remain unavailable.

The internal endpoint is `/mcp`. If the public endpoint has a path prefix, the
reverse proxy maps it to this internal path and forwards the original Host.
Protected-resource metadata is public at
`/.well-known/oauth-protected-resource` and at the path-specific form derived
from `MCP_RESOURCE_URL` (for example `/.well-known/oauth-protected-resource/mcp`).
The 401 challenge advertises that metadata and the required scope. Metadata points
to Keycloak's issuer; clients use its OIDC discovery and an already registered
client with appropriate redirect URIs and PKCE. No registration endpoint, OAuth
proxy, new credentials or grants are created by this server.

Each POST requires a Bearer JWT verified against the realm certificate endpoint,
RS256 signature, exact issuer/audience, expiration, Keycloak `typ=Bearer` claim,
required scope and subject mapping. ID tokens and tokens for unrelated services
are rejected. Host and Origin are checked; browser origins require an explicit
HTTPS `MCP_ALLOWED_ORIGINS` allowlist. Tokens in URL query strings are not accepted.
The server limits request bodies and uses bounded request/JWKS timeouts. Errors
never include tokens or request bodies.

This is stateless Streamable HTTP with JSON responses using the pinned MCP SDK's
negotiated protocol (tested with `2025-11-25`). Standalone GET/SSE, persistent
sessions and server-initiated notifications are not provided. StdIO remains the
default. Synthetic integration tests use local JWT signing keys, local HTTP and
mocked Xero reads; they do not access the existing Keycloak realm or Xero.

Before rollout, verify the actual realm's issuer, signing algorithm, dedicated
audience, required scope, subject IDs and client discovery/PKCE compatibility.
Validate token expiration/key rotation and test each authorised organisation with
approved Demo Company access. Real recoding still requires explicit approval and
proof that the original statement-line match survives; no flag-setting,
unreconcile/delete/recreate workaround is enabled.
