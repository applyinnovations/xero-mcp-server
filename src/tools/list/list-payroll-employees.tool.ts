import { employeePhone, employeeEngagement, type PayrollEmployee } from "../../payroll/operations.js";
import { listXeroPayrollEmployees } from "../../handlers/list-xero-payroll-employees.handler.js";
import { CreatePayrollTool } from "../../helpers/create-payroll-tool.js";

const ListPayrollEmployeesTool = CreatePayrollTool({
  name: "list-payroll-employees",
  description: `List all payroll employees in Xero.
This retrieves comprehensive employee details including names, User IDs, dates of birth, email addresses, gender, phone numbers, start dates, region-specific employment information, titles, and when records were last updated.
The response presents a complete overview of all staff currently registered in your Xero payroll, with their personal and employment information. If there are many employees, ask the user if they would like to see more detailed information about specific employees before proceeding.`,
  access: "read",
  schema: {},
  handler: async () => {
    const response = await listXeroPayrollEmployees();

    if (response.isError) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error listing payroll employees: ${response.error}`,
          },
        ],
      };
    }

    const employees = response.result;

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${employees?.length || 0} payroll employees:`,
        },
        ...(employees?.map((employee: PayrollEmployee) => ({
          type: "text" as const,
          text: [
            `Employee: ${employee.employeeID}`,
            employee.email ? `Email: ${employee.email}` : "No email",
            employee.gender ? `Gender: ${employee.gender}` : null,
            employeePhone(employee) ? `Phone: ${employeePhone(employee)}` : null,
            employee.startDate ? `Start Date: ${employee.startDate}` : null,
            employeeEngagement(employee)
              ? `Engagement Type: ${employeeEngagement(employee)}`
              : "No status", // Permanent, FixedTerm, Casual
            "employmentType" in employee && employee.employmentType ? `Employment Type: ${employee.employmentType}` : null,
            "status" in employee && employee.status ? `Status: ${employee.status}` : null,
            employee.title ? `Title: ${employee.title}` : null,
            employee.firstName ? `First Name: ${employee.firstName}` : null,
            employee.lastName ? `Last Name: ${employee.lastName}` : null,
            employee.updatedDateUTC
              ? `Last Updated: ${employee.updatedDateUTC}`
              : null,
          ]
            .filter(Boolean)
            .join("\n"),
        })) || []),
      ],
    };
  },
});

export default ListPayrollEmployeesTool;
