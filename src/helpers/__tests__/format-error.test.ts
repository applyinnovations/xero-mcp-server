import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { formatError, xeroErrorDetails, xeroValidationMessages } from "../format-error.js";

function makeAxiosError(status: number, detail?: string): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers };
  const err = new AxiosError(
    "Request failed",
    String(status),
    config as never,
    null,
    {
      status,
      data: detail ? { Detail: detail } : {},
      statusText: "",
      headers: {},
      config,
    } as never,
  );
  return err;
}

describe("formatError", () => {
  describe("AxiosError mapping", () => {
    it("maps 401 to authentication message", () => {
      expect(formatError(makeAxiosError(401))).toBe(
        "Authentication failed. Please check your Xero credentials.",
      );
    });

    it("maps 403 to permission message", () => {
      expect(formatError(makeAxiosError(403))).toBe(
        "You don't have permission to access this resource in Xero.",
      );
    });

    it("maps 404 to not-found message", () => {
      expect(formatError(makeAxiosError(404))).toBe(
        "The requested resource was not found in Xero.",
      );
    });

    it("maps 429 to rate-limit message", () => {
      expect(formatError(makeAxiosError(429))).toBe(
        "Too many requests to Xero. Please try again in a moment.",
      );
    });

    it("returns response.data.Detail for non-mapped statuses", () => {
      expect(formatError(makeAxiosError(400, "Field is required"))).toBe(
        "Field is required",
      );
    });

    it("returns generic message when no Detail is provided", () => {
      expect(formatError(makeAxiosError(500))).toBe(
        "An error occurred while communicating with Xero.",
      );
    });
  });

  describe("xero-node SDK error shape", () => {
    it.each([401, 403])("distinguishes insufficient_scope from an expired credential at HTTP %s without exposing its envelope", status => {
      const error = JSON.stringify({ response: { statusCode: status,
        headers: { "www-authenticate": 'Bearer error="insufficient_scope"', "set-cookie": "SECRET_COOKIE" },
        body: { Detail: "insufficient_scope", UnrelatedRecord: "PRIVATE_RECORD" },
        request: { headers: { authorization: "Bearer SECRET_TOKEN" } },
      } });
      const message = formatError(error);
      expect(message).toContain("OAuth consent");
      expect(message).toContain("refresh cannot add scopes");
      expect(message).not.toContain("check your Xero credentials");
      expect(xeroErrorDetails(error).providerMessage).toBe(message);
      for (const secret of ["SECRET_TOKEN", "SECRET_COOKIE", "PRIVATE_RECORD"]) expect(message).not.toContain(secret);
    });

    it("recognizes only the scope marker in allowed authentication response fields", () => {
      expect(formatError({ response: { statusCode: 401, body: { Invoice: { Reference: "insufficient_scope" } } } }))
        .toBe("Authentication failed. Please check your Xero credentials.");
      const error = makeAxiosError(401, "insufficient_scope");
      expect(formatError(error)).toContain("OAuth consent");
    });

    it("decodes the actual serialized SDK envelope without exposing request credentials or echoed records", () => {
      const error = JSON.stringify({ response: { statusCode: 400,
        request: { headers: { authorization: "Bearer SECRET_TOKEN", cookie: "SECRET_COOKIE" } },
        headers: { "set-cookie": "SECRET_RESPONSE_COOKIE" },
        body: { Elements: [{ Description: "PRIVATE_RECORD", ValidationErrors: [{ Message: "Account code is not valid for this document." }] }] },
      } });
      expect(xeroErrorDetails(error)).toEqual({ httpStatus: 400, providerMessage: "400 HTTP error", validationMessages: ["Account code is not valid for this document."] });
      expect(formatError(error)).toBe("400 HTTP error");
      for (const secret of ["SECRET_TOKEN", "SECRET_COOKIE", "PRIVATE_RECORD", "SECRET_RESPONSE_COOKIE"]) {
        expect(JSON.stringify(xeroErrorDetails(error)) + formatError(error)).not.toContain(secret);
      }
    });

    it("bounds provider messages and redacts bearer values in the allowed text fields", () => {
      const error = JSON.stringify({ response: { statusCode: 400, body: {
        Detail: "Invalid Bearer SECRET_TOKEN", ValidationErrors: [{ Message: "Bad Bearer SECRET_TOKEN\n" + "x".repeat(2000) }],
      } } });
      expect(formatError(error)).toBe("400 HTTP error: Invalid Bearer [redacted]");
      expect(xeroErrorDetails(error).validationMessages[0]).toHaveLength(512);
      expect(JSON.stringify(xeroErrorDetails(error))).not.toContain("SECRET_TOKEN");
      expect(xeroValidationMessages({ bankTransactions: [{ validationErrors: [{ message: "Invalid account" }] }] })).toEqual(["Invalid account"]);
    });

    it.each(["not JSON", "null", "[]", '{"response":{"statusCode":"400"}}', '{"response":{"statusCode":1000}}', "x".repeat(1_048_577)])("does not invent an HTTP rejection for malformed or unrecognized failures", error => {
      expect(xeroErrorDetails(error).httpStatus).toBeUndefined();
    });

    it("uses only response fields for generic errors with an attached HTTP status", () => {
      const error = Object.assign(new Error("SECRET_ARBITRARY_MESSAGE"), { response: { status: 400, data: { Detail: "Invalid account" } } });
      expect(xeroErrorDetails(error)).toEqual({ httpStatus: 400, providerMessage: "400 HTTP error: Invalid account", validationMessages: [] });
    });

    it("sanitizes the Axios provider detail as well as the SDK envelope", () => {
      expect(formatError(makeAxiosError(400, "Invalid Bearer SECRET_TOKEN"))).toBe("Invalid Bearer [redacted]");
    });

    it("extracts problem.detail and title without leaking request headers", () => {
      const sdkError = {
        response: {
          statusCode: 405,
          body: {
            httpStatusCode: "MethodNotAllowed",
            problem: {
              title: "MethodNotAllowed",
              detail: "Method not allowed for the current customer jurisdiction.",
              status: 405,
            },
          },
          headers: { "set-cookie": "ak_bmsc=secret" },
        },
        request: {
          headers: { authorization: "Bearer eyJSECRET" },
        },
      };

      const result = formatError(sdkError);

      expect(result).toBe(
        "405 MethodNotAllowed: Method not allowed for the current customer jurisdiction.",
      );
      expect(result).not.toContain("Bearer");
      expect(result).not.toContain("eyJSECRET");
      expect(result).not.toContain("set-cookie");
    });

    it("maps 401 SDK error to the standard auth message", () => {
      const sdkError = {
        response: { statusCode: 401, body: {} },
        request: { headers: { authorization: "Bearer leaky" } },
      };

      const result = formatError(sdkError);
      expect(result).toBe(
        "Authentication failed. Please check your Xero credentials.",
      );
      expect(result).not.toContain("Bearer");
    });

    it("falls back to status code + title when detail is missing", () => {
      const sdkError = {
        response: {
          statusCode: 502,
          body: { httpStatusCode: "BadGateway" },
        },
      };

      expect(formatError(sdkError)).toBe("502 BadGateway");
    });

    it("falls back to a generic title when neither problem nor httpStatusCode is present", () => {
      const sdkError = { response: { statusCode: 502 } };
      expect(formatError(sdkError)).toBe("502 HTTP error");
    });
  });

  describe("plain Error", () => {
    it("returns the error message", () => {
      expect(formatError(new Error("Employee ID is required"))).toBe(
        "Employee ID is required",
      );
    });
  });

  describe("unknown error shapes", () => {
    it("returns a generic message and never stringifies the object", () => {
      const leakyUnknown = {
        request: { headers: { authorization: "Bearer LEAKY_TOKEN" } },
      };

      const result = formatError(leakyUnknown);

      expect(result).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
      expect(result).not.toContain("Bearer");
      expect(result).not.toContain("LEAKY_TOKEN");
    });

    it("handles string errors safely", () => {
      expect(formatError("something blew up")).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
    });

    it("handles null safely", () => {
      expect(formatError(null)).toBe(
        "An unexpected error occurred while communicating with Xero.",
      );
    });
  });
});
