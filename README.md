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

Writes require global company permission and verified action authorization.
See [Account coding tool](#account-coding-tool)
for permissions, configuration and reconciliation-verification requirements.

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
redacted. Live refresh/revocation tests require separately approved access;
automated tests use only synthetic token sets and mocked HTTP responses.

## Authenticated remote MCP with an OIDC issuer

Select `MCP_TRANSPORT=http` only when preparing an authenticated remote service.
HTTP mode requires the durable OAuth configuration above and an explicit server
`XERO_ALLOWED_TENANT_IDS` allowlist. The default bind is `127.0.0.1:3000`; set
`MCP_HOST`/`MCP_PORT` for the intended network only during an approved deployment.
Production traffic must use a TLS reverse proxy. Configure deployment and the
identity provider separately.

Required settings:

- `MCP_ISSUER`: exact HTTPS issuer identifier, including a trailing slash if the
  provider uses one.
- `MCP_ACCESS_TOKEN_PROFILE`: `rfc9068` (default) or explicitly `bearer-claim`;
  the contracts below are strict and never automatically fall back.
- `MCP_JWKS_URL`: optional HTTPS JWKS URL on the same origin as the issuer, without
  credentials, query or fragment. Omit to use OIDC discovery.
- `MCP_RESOURCE_URL`: public HTTPS endpoint ending in `/mcp`.
- `MCP_AUDIENCE`: dedicated token audience for this MCP resource; defaults to its
  public endpoint URL. Access tokens must include that audience. Use a resource
  audience distinct from OIDC login client IDs.
- `MCP_READ_SCOPE`: required access-token scope, default `xero:read`.
- `MCP_SUBJECT_TENANTS_JSON`: JSON mapping exact issuer subject IDs to arrays of
  authorized tenant UUIDs. Subjects absent from this mapping are denied.

The server intersects subject permissions with its tenant allowlist and the
organisations connected to the Xero grant. An authenticated subject cannot select
another subject's tenant. The grant is server-managed; incoming access tokens are never
forwarded to Xero. Different POST requests get separate MCP servers and client
contexts. Write tools remain unavailable.

The internal endpoint is `/mcp`. If the public endpoint has a path prefix, the
reverse proxy maps it to this internal path and forwards the original Host.
Protected-resource metadata is public at
`/.well-known/oauth-protected-resource` and at the path-specific form derived
from `MCP_RESOURCE_URL` (for example `/.well-known/oauth-protected-resource/mcp`).
The 401 challenge advertises that metadata and the required scope. Metadata points
to the configured issuer; clients use its OIDC discovery and an already registered
client with appropriate redirect URIs and PKCE. No registration endpoint, OAuth
proxy, new credentials or grants are created by this server.

Each POST requires a signed JWT access token. Both supported profiles require
RS256, exact configured `iss`, resource `aud` (string or array containing the
configured audience), nonempty `sub`, numeric `iat`/`exp`, `exp > iat`, and no
future issuance beyond five seconds of clock tolerance. Expiration and optional
`nbf` are checked by `jose`; five seconds of tolerance also applies there. A
space-delimited string `scope` must contain the exact required scope and the
subject must have an explicit tenant mapping.

- `rfc9068`: protected header `typ=at+jwt` or `application/at+jwt`; nonempty
  string `client_id` and `jti` are required. No payload `typ` assumption is made.
- `bearer-claim`: protected header `typ=JWT` (also `application/JWT`, compared
  case-insensitively by `jose`) AND payload `typ=Bearer`. This is an explicit
  compatibility contract for issuers that distinguish access tokens this way.
  Keycloak is the documented example. Its ID-token `typ=ID` and refresh-token
  formats are rejected. This profile is never selected by inspecting a token.

Generic JWTs, opaque tokens, other algorithms and ID tokens are unsupported.
Token purpose is established by the selected signed type contract plus a dedicated
resource audience; the issuer must reserve that contract for access tokens and
must not issue ID tokens with this resource audience. This is an administrator
configuration requirement, not a claim that arbitrary OIDC tokens are safe.

Unless `MCP_JWKS_URL` is configured, the server fetches
`<issuer-with-final-slash-removed>/.well-known/openid-configuration`. Metadata
`issuer` must match `MCP_ISSUER` exactly. Its absolute HTTPS `jwks_uri` must share
the issuer's origin and contain no credentials, query or fragment. Cross-origin
CDNs are deliberately unsupported. Neither token `iss` nor `jku`/`x5u` can change
this trust root. Discovery and JWKS requests reject redirects, have a five-second
complete-response timeout and a 64 KiB body limit. Discovery is shared across
concurrent requests, cached for the process lifetime after success, and retried
after a 30-second cooldown on failure. Restart to adopt changed metadata/key
URLs. `jose` caches JWKS for ten minutes and can refetch for an unknown key after
a 30-second cooldown. A newly rotated key can therefore be rejected briefly;
removed cached keys can remain accepted until cache expiry (subject to token
expiry). There is no introspection or immediate revocation service. Outages fail
closed when discovery or a needed key cannot be resolved; usable cached keys
continue validating within the cache policy.

For an existing Keycloak realm, set `MCP_ISSUER` to its exact realm issuer and
explicitly select `MCP_ACCESS_TOKEN_PROFILE=bearer-claim`. Leave `MCP_JWKS_URL`
blank to discover its actual key endpoint. Configure the dedicated resource
audience, scope and subject mapping using the settings above. No provider route
or realm name is encoded in the server.

Host and Origin are checked; browser origins require an explicit HTTPS
`MCP_ALLOWED_ORIGINS` allowlist. Tokens in URL query strings are not accepted.
The server limits request bodies. Errors never include tokens or request bodies.

This is stateless Streamable HTTP with JSON responses using the pinned MCP SDK's
negotiated protocol (tested with `2025-11-25`). Standalone GET/SSE, persistent
sessions and server-initiated notifications are not provided. StdIO remains the
default. Synthetic integration tests use local JWT signing keys, local HTTP and
mocked Xero reads; they do not access the existing Keycloak realm or Xero.
Authentication tests exercise synthetic Keycloak-style and RFC 9068 discovery/
token profiles, failures and key rotation. These prove the defined contracts in
fixtures, not live compatibility with a provider or client application.

Before rollout, verify the actual issuer's discovery, selected token profile, signing algorithm, dedicated
audience, required scope, subject IDs and client discovery/PKCE compatibility.
Validate token expiration/key rotation and authorised reads with approved access.
Account-coding acceptance must verify field preservation and actual statement
linkage before wider use; the API reconciliation flag alone is insufficient.


## Hosted owner-authorized Xero PKCE onboarding

This optional flow runs inside the HTTP MCP service. Create an OAuth2 **Auth Code
with PKCE** app (Mobile/Desktop in the developer portal), without a client secret.
Register exactly the HTTPS origin of `MCP_RESOURCE_URL` plus `/xero/callback`;
for `https://mcp.example.com/mcp`, use `https://mcp.example.com/xero/callback`.
Xero's [PKCE documentation](https://developer.xero.com/documentation/guides/oauth2/pkce-flow/)
permits HTTPS callbacks and specifies the public-client token exchange. Callback
routes exist only in an image built with this feature and an approved deployment;
registering a URI alone does not make it live.

In addition to durable OAuth paths/client ID and the normal OIDC settings, enable:

| Setting | Value |
| --- | --- |
| `XERO_ONBOARDING_ENABLED` | `true`; default is `false`. |
| `MCP_CONNECT_SUBJECTS_JSON` | Nonempty JSON array of exact authorized issuer subject IDs. |
| `MCP_CONNECT_CLIENT_ID` | Exact approved OAuth client ID: access-token `azp` for `bearer-claim`, `client_id` for `rfc9068`. |
| `MCP_CONNECT_SCOPE` | Separate required owner scope; default `xero:connect`. |

Bootstrap permits empty `XERO_ALLOWED_TENANT_IDS` and `{}` for
`MCP_SUBJECT_TENANTS_JSON` only in explicitly enabled HTTP onboarding. Accounting
tools stay unavailable until the tenant allowlist, subject mapping and `xero:read`
permission are configured. Onboarding requires the exact owner, client, scope,
issuer/audience, signature and access-token profile; ordinary readers receive no
onboarding tools. The issuer must reserve the resource audience for access tokens
and attach the owner scope only to its approved client/subjects.

Provision the 32-byte base64 encryption key through the operator's secret manager;
never send it, access/refresh tokens or client credentials through chat. Mount a
private regular 0600 key file and writable private state directory. Kubernetes
For a secret-manager projection, set `XERO_TOKEN_KEY_SOURCE_FILE` to the mounted
source and `XERO_TOKEN_KEY_FILE` to a writable private destination. HTTP startup
copies only that configured source into a regular 0600 key file, prepares the
private 0700 state directory and validates existing encrypted state before
listening. Projected source symlinks are supported; live key/state symlinks are
rejected. Startup preserves stored tokens and performs no grant or refresh.
An empty state directory is accepted only for explicitly enabled onboarding;
revoked state remains available for explicit owner recovery. No key is generated
by this server. Do not set `XERO_CLIENT_SECRET` or a static bearer token for this
public PKCE flow. No imported token envelope or local consent helper is required.

After approved deployment, configure the existing MCP client's OAuth scope to
include the owner scope and proceed only when the human authorizes consent:

1. Call `begin-xero-connection` and give its `startUrl` to the owner. Opening that
   link in a browser starts a single-use, five-minute capability, sets a Secure/
   HttpOnly/SameSite=Lax host cookie and directs the owner to Xero. S256 PKCE and
   random state bind the callback to the transaction and browser. The verifier,
   codes and tokens are never returned through MCP or logged by the service.
2. The owner signs in and selects one intended organisation. Call
   `get-xero-connection-status` with the transaction ID to review names and UUIDs.
   Call `continue-xero-connection` only when the owner requests the next consent.
   Use the same Xero user each time; the latest token must see every prior tenant.
3. Connect as many organisations as intended, then ask the owner to confirm that exact
   list. Only then call `confirm-xero-connection` with its UUIDs and `confirmed=true`.
   The service rechecks connections and atomically writes encrypted state under
   the refresh/import lock. It never overwrites healthy stored state. Accounting
   tools still require a reviewed tenant/subject configuration update.

The consent scopes are exactly `offline_access accounting.banktransactions.read
accounting.settings.read`, using current [granular read scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/).
These cover bank transactions and settings; other enumerated accounting/payroll
tools need separately approved scopes and may fail with this minimal grant.
The [Starter tier](https://developer.xero.com/pricing) has no monthly fee and allows
five connections. Its bulk-consent feature is unavailable; connect organisations
sequentially, then use the latest token for the same user's connected tenants.
The server does not configure an expected count or impose a three/five-organisation
completion gate. The owner chooses when to stop and must confirm every currently
connected tenant exactly; Xero's app/tier limits still apply. Existing response
byte limits, request timeouts and transaction expiry bound resource use.

One 15-minute transaction is kept in memory per single-writer server. Restart or
expiry discards unconfirmed tokens; the owner can retry. Declining confirmation
does not revoke already-consented Xero connections, and no automatic disconnect
is attempted. Keep callback queries and credential headers out of proxy/access
logs; the start capability uses a URL fragment to avoid request-URL logging. Browser
routes are exactly `/xero/start`, `/xero/callback`, `/xero/result` on the configured
public Host. They ignore forwarded-host/protocol headers and return no tokens.

For an explicitly requested `invalid_grant` recovery, begin with
`renewRevokedGrant=true`. Recovery requires the persisted reauthorization marker
and a complete configured tenant set. Confirmation replaces only that marked
state under lock, after checking the identical tenant set; healthy grants remain
protected. Back up the current encrypted state and key separately.

Tests use synthetic keys/tokens and mocked Xero endpoints. Real app consent,
browser/hosted-client behavior, issued-token/scopes, all organisations and durable
refresh/restart require live acceptance checks. Account coding requires the
global company and action/OAuth permissions described below.

### xlab CI

The `.tekton` definitions use the existing Pipelines-as-Code GitHub integration
and shared `git-clone-v2` / `buildkit-build-push` tasks. PRs targeting `main` run
build/tests/lint with a fresh source workspace and no registry or Git credential
workspace. Main pushes build the Dockerfile (including build/tests/lint) and push
`registry.registry.svc.cluster.local/xero-mcp-server:<full-SHA>` using the existing
registry credential and BuildKit cache. PaC handles GitHub checks, cancellation
and retention of five runs per workflow; no separate listener or reporting service
is needed. Registration lives in `xlab-deployments` with default-branch pipeline
provenance. PipelineRun results expose the image digest; deployments should pin
that tested digest. The shared builder/registry do not enforce immutable SHA tags
against a rebuild, and the current semver pruner skips SHA-only repositories.
CI does not connect to Xero, enable writes or deploy the MCP service.

## Account coding tool

Use `list-bank-transactions` / `get-bank-transaction` for inspection and
`list-accounts` for the chart. The agent collaborates with the user and manages
approval independently. The server exposes one focused mutation:

```json
{
  "tenantId": "<coding-tenant-uuid>",
  "bankTransactionId": "<existing-transaction-uuid>",
  "changes": [{ "lineItemId": "<existing-line-uuid>", "accountCode": "500", "expectedAccountCode": "400" }],
  "idempotencyKey": "<caller-generated-request-uuid>",
  "expectedUpdatedDateUTC": "2026-01-02T00:00:00Z"
}
```

Call `code-bank-transaction` directly after the agent/client's approval process.
`expectedAccountCode` and `expectedUpdatedDateUTC` are optional technical stale-state
checks from ordinary reads. No full transaction package is passed as input. The
handler fetches current state and chart internally, validates the selected lines
and active non-bank targets, and changes only account code and its associated GL
account ID. Descriptions/references, transaction/line IDs, untouched lines,
tracking, explicit tax coding/amounts, quantities/amounts, currency/rate and totals
are preserved and checked through a GET after one targeted POST with `unitdp=4`.
Computed totals, currency/rate read fields and `IsReconciled` are omitted from POST.

Existing authorised SPEND/RECEIVE entries may be reconciled or unreconciled;
`list-bank-transactions` with `reconciledOnly: false` includes both states. Raw
bank-feed statement lines, GST/tax edits, line creation/deletion, payments,
transfers and lodgements are excluded. No generic CRUD write tools are registered.

The compact result includes IDs, caller's idempotency key, actor, completion time,
selected account-code differences and outcome (`updated`, `unchanged`,
`not-applied`, `rejected`, `unknown` or `drift`). Errors set MCP `isError: true`;
known Xero rejection status is reported without credentials or raw error payloads.
Unknown outcomes and post-write drift require inspection through ordinary reads
and Xero's statement UI before retrying or undoing. Reuse an idempotency key only
for the identical upstream request. [Xero caches keys for six minutes from the
first call and compares the actual URL, body and HTTP method](https://developer.xero.com/documentation/guides/idempotent-requests/idempotency/);
after expiry, reuse is processed as a new request. This handler rebuilds the POST
from fresh reads, so identical MCP arguments after an external edit can produce a
different upstream body. The key is not an unlimited replay guarantee; inspect
uncertain outcomes before another call. The server never retries or persists
receipts. The agent/client records results and any before/after evidence it needs.
Only a small in-flight set rejects overlapping local calls for the same transaction; it is
released on completion and stores no approval or outcome state.

Company access is shared across the entire MCP. `XERO_ALLOWED_TENANT_IDS` and
`MCP_SUBJECT_TENANTS_JSON` retain their read-access meaning. Set
`XERO_TENANT_ACCESS_JSON` to a JSON object mapping allowed tenant UUIDs to
`read-only` or `read-write`; omitted companies default to read-only. Unknown
companies or invalid values fail startup. All SDK API clients check the actual
HTTP method and final tenant header before sending a request. Every mutation
requires both the shared company policy and verified request write permission;
a readable company cannot become writable by changing tool arguments or headers.
Every tool definition requires explicit `access: "read"` or `access: "write"`
metadata. Central registration rejects missing classifications and derives MCP
read-only hints from that field. Read invocations discard request write authority;
company mutations require the shared write guard regardless of tool name.
Existing create/update/delete tools remain unregistered. Owner-only OAuth onboarding manages read connectivity separately;
it does not mutate company records or request write consent.

HTTP write authorization requires mapped read subjects in
`MCP_RECODE_SUBJECTS_JSON`, `MCP_RECODE_CLIENT_ID`, and a
separate action scope `MCP_RECODE_SCOPE` (default `xero:code`). Only matching
verified user/client tokens with read and coding scopes and access to a shared
read-write company see `code-bank-transaction`. Each call rechecks company access.
There is no operation-specific feature switch or separate coding tenant policy.
Without action authorization, HTTP grants no request write permission. Partial
authorization configuration fails startup. All companies may remain read-only
with action authorization configured; the global policy denies their mutations.
Stdio never registers the coding tool
or establishes request write permission.

Choose an explicit approved `XERO_RECODING_GRANT_MODE=shared` or `separate`.
Coding requires actual Xero consent for `accounting.banktransactions`; read-only
consent and token refresh cannot add it. Shared uses the existing grant; adding
`accounting.banktransactions` broadens that grant across all connected tenants,
while the shared server company policy still denies all mutations for read-only
companies. Separate uses an independently approved PKCE app/grant in
`XERO_RECODING_TOKEN_FILE`,
`XERO_RECODING_TOKEN_KEY_FILE`, `XERO_RECODING_CLIENT_ID`, with a distinct app ID,
non-aliased token state (including symlinks/hard links), and only the coding tenant.
Grant construction, consent scope and connected-tenant checks belong to the auth
layer. Neither consent nor credentials are created by this tool.

Xero documents no conditional `If-Match`; optional preconditions and the local
in-flight guard do not eliminate outside edits between GET and POST. Coordinate
other edits of the selected transaction during validation. Receipts always report
`statementLinkageVerified: false`; `IsReconciled` alone cannot prove the actual
statement match survived. Before wider use, compare complete before/after records
for unchanged IDs, tracking, tax, currency and totals, and follow the same existing
imported statement line in Xero to verify it still links to the identical bank
transaction ID and bank account. Record that external witness separately. Do not
unreconcile, recreate matches or force the reconciliation flag to manufacture
proof. Each account assignment requires the user's approval through the client.
