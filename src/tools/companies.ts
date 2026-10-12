import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd, parseLinkHeader, requestFirstOf } from "../freshdesk.js";
import {
  CompanyCreate,
  CompanyFieldCreate,
  CompanyFieldUpdate,
  CompanyUpdate,
} from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

const companyId = z.number().int().describe("Company ID.");
const importStatus = z
  .enum(["in_progress", "completed", "cancelled", "failed"])
  .optional()
  .describe("Only imports in this state.");

export function registerCompanyTools(server: McpServer) {
  tool(
    server,
    "list_companies",
    "List companies (customer organisations) with pagination. Returns { companies, pagination }.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/companies", { page, per_page });
      if (!res.ok) return text(errorPayload("Failed to list companies", res));
      const pagination = parseLinkHeader(res.headers.get("link"));
      return text({
        companies: res.data,
        pagination: {
          current_page: page,
          next_page: pagination.next,
          prev_page: pagination.prev,
          per_page,
        },
      });
    },
  );

  tool(
    server,
    "view_company",
    "Get a company by ID (name, domains, health_score, account_tier, renewal_date, industry, custom_fields…).",
    { company_id: companyId },
    async ({ company_id }) => {
      const res = await fd.get(`/companies/${company_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to fetch company", res));
    },
  );

  tool(
    server,
    "search_companies",
    "Autocomplete companies by the start of their name. Returns id + name only — use this to resolve a company name to an ID.",
    { query: z.string().describe("Name prefix, e.g. 'acme'.") },
    async ({ query }) => {
      const res = await fd.get("/companies/autocomplete", { name: query });
      return text(res.ok ? res.data : errorPayload("Failed to search companies", res));
    },
  );

  tool(
    server,
    "filter_companies",
    "Filter companies with Freshdesk query language (BETA). Syntax: field:value with AND/OR and parentheses; strings in single quotes; " +
      ":> / :< for numeric and date ranges; null for empty. Fields: domain, created_at, updated_at (dates 'YYYY-MM-DD') and custom company fields by name. " +
      "Example: \"domain:'acme.com' OR industry:'Retail'\". 30 results/page, max 10 pages. Returns { results, total }.",
    {
      query: z.string().describe("Query without the surrounding double quotes."),
      page: z.number().int().min(1).max(10).optional().describe("Result page 1-10."),
    },
    async ({ query, page }) => {
      const q = /^".*"$/s.test(query.trim()) ? query.trim() : `"${query.trim()}"`;
      const res = await fd.get("/search/companies", { query: q, page });
      return text(res.ok ? res.data : errorPayload("Failed to filter companies", res));
    },
  );

  tool(
    server,
    "create_company",
    "Create a company. Required: name (unique). Optional: description, note, domains[] (contacts with these email domains auto-link), " +
      "health_score, account_tier, renewal_date, industry, custom_fields{}.",
    { company: z.record(z.any()).describe("Company payload.") },
    async ({ company }) => {
      const v = validate(CompanyCreate, company);
      if (!v.ok) return v.reply;
      const res = await fd.post("/companies", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create company", res));
    },
  );

  tool(
    server,
    "update_company",
    "Partially update a company; only sent keys change. Setting domains replaces the whole list.",
    { company_id: companyId, company: z.record(z.any()).describe("Fields to change.") },
    async ({ company_id, company }) => {
      const v = validate(CompanyUpdate, company);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/companies/${company_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update company", res));
    },
  );

  tool(
    server,
    "delete_company",
    "Permanently delete a company. Its contacts and tickets are kept but unlinked. Irreversible.",
    { company_id: companyId },
    async ({ company_id }) => {
      const res = await fd.delete(`/companies/${company_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete company", res));
    },
  );

  tool(
    server,
    "list_company_contacts",
    "List contacts that belong to a company.",
    { company_id: companyId, ...pageArgs },
    async ({ company_id, page, per_page }) => {
      const res = await fd.get("/contacts", { company_id, page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list company contacts", res));
    },
  );

  // ─── Export / Import ──────────────────────────────
  tool(
    server,
    "export_companies",
    "Start an async CSV export of all companies. Returns an export id — poll view_company_export until it has a download url.",
    {
      default_fields: z
        .array(z.string())
        .describe("Default company fields to export, e.g. ['name','domains','description']."),
      custom_fields: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Custom company field names to export."),
    },
    async ({ default_fields, custom_fields }) => {
      const res = await fd.post("/companies/export", { fields: { default_fields, custom_fields } });
      return text(res.ok ? res.data : errorPayload("Failed to start company export", res));
    },
  );

  tool(
    server,
    "view_company_export",
    "Check a company export job; when complete the response includes the CSV download url.",
    { export_id: z.string().describe("Export id returned by export_companies.") },
    async ({ export_id }) => {
      const res = await requestFirstOf(["GET", "POST"], `/companies/export/${export_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view company export", res));
    },
  );

  tool(
    server,
    "list_company_imports",
    "List the 5 most recent company CSV imports (status, record counts, failure report).",
    { status: importStatus },
    async ({ status }) => {
      const res = await fd.get("/companies/imports", { status });
      return text(res.ok ? res.data : errorPayload("Failed to list company imports", res));
    },
  );

  tool(
    server,
    "view_company_import",
    "View a company import: progress, completion estimate or failures.",
    { import_id: z.number().int().describe("Import ID.") },
    async ({ import_id }) => {
      const res = await fd.get(`/companies/imports/${import_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view company import", res));
    },
  );

  tool(
    server,
    "cancel_company_import",
    "Cancel an in-progress company import.",
    { import_id: z.number().int().describe("Import ID.") },
    async ({ import_id }) => {
      const res = await fd.put(`/companies/imports/${import_id}/cancel`);
      return text(
        res.ok
          ? (res.data ?? { success: true })
          : errorPayload("Failed to cancel company import", res),
      );
    },
  );

  // ─── Company fields ───────────────────────────────
  const companyFieldId = z.number().int().describe("Company field ID.");

  tool(
    server,
    "list_company_fields",
    "List all company field definitions (system + custom) with names, types and choices.",
    {},
    async () => {
      const res = await fd.get("/company_fields");
      return text(res.ok ? res.data : errorPayload("Failed to list company fields", res));
    },
  );

  tool(
    server,
    "view_company_field",
    "View one company field definition.",
    { company_field_id: companyFieldId },
    async ({ company_field_id }) => {
      const res = await fd.get(`/company_fields/${company_field_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view company field", res));
    },
  );

  tool(
    server,
    "create_company_field",
    "Admin: create a custom company field. Required: label, type ('custom_text' | 'custom_paragraph' | 'custom_checkbox' | " +
      "'custom_number' | 'custom_dropdown' | 'custom_phone_number' | 'custom_url' | 'custom_date'). Optional: position, required_for_agents, choices[].",
    { company_field: z.record(z.any()).describe("Company field payload.") },
    async ({ company_field }) => {
      const v = validate(CompanyFieldCreate, company_field);
      if (!v.ok) return v.reply;
      const res = await fd.post("/company_fields", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create company field", res));
    },
  );

  tool(
    server,
    "update_company_field",
    "Admin: update a company field; only sent keys change.",
    {
      company_field_id: companyFieldId,
      company_field: z.record(z.any()).describe("Fields to change."),
    },
    async ({ company_field_id, company_field }) => {
      const v = validate(CompanyFieldUpdate, company_field);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/company_fields/${company_field_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update company field", res));
    },
  );

  tool(
    server,
    "delete_company_field",
    "Admin: delete a custom company field.",
    { company_field_id: companyFieldId },
    async ({ company_field_id }) => {
      const res = await fd.delete(`/company_fields/${company_field_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete company field", res));
    },
  );
}
