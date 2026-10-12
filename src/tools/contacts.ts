import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd, requestFirstOf } from "../freshdesk.js";
import {
  ContactCreate,
  ContactFieldCreate,
  ContactFieldUpdate,
  ContactsMerge,
  ContactUpdate,
  MakeAgentFields,
} from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

const contactId = z.number().int().describe("Contact (customer) ID.");
const importStatus = z
  .enum(["in_progress", "completed", "cancelled", "failed"])
  .optional()
  .describe("Only imports in this state.");

export function registerContactTools(server: McpServer) {
  tool(
    server,
    "list_contacts",
    "List contacts (customers/requesters), optionally filtered by exact email, phone, mobile, company or state. " +
      "Deleted contacts are excluded unless state='deleted'. For partial-name lookup use search_contacts; for custom-field queries use filter_contacts.",
    {
      ...pageArgs,
      email: z.string().email().optional().describe("Exact email match."),
      mobile: z.string().optional().describe("Exact mobile number."),
      phone: z.string().optional().describe("Exact phone number."),
      company_id: z.number().int().optional().describe("Contacts of this company."),
      state: z
        .enum(["blocked", "deleted", "unverified", "verified"])
        .optional()
        .describe("Contact state."),
      updated_since: z.string().optional().describe("ISO-8601 UTC timestamp."),
    },
    async (args) => {
      const res = await fd.get("/contacts", args);
      return text(res.ok ? res.data : errorPayload("Failed to list contacts", res));
    },
  );

  tool(
    server,
    "get_contact",
    "Get a contact by ID (name, emails, phones, company, custom_fields, tags…).",
    { contact_id: contactId },
    async ({ contact_id }) => {
      const res = await fd.get(`/contacts/${contact_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to fetch contact", res));
    },
  );

  tool(
    server,
    "search_contacts",
    "Autocomplete contacts by the start of their name (fast, partial match). Returns id + name only.",
    { query: z.string().describe("Name prefix to search, e.g. 'john'.") },
    async ({ query }) => {
      const res = await fd.get("/contacts/autocomplete", { term: query });
      return text(res.ok ? res.data : errorPayload("Failed to search contacts", res));
    },
  );

  tool(
    server,
    "filter_contacts",
    "Filter contacts with Freshdesk query language (BETA). Syntax: field:value with AND/OR and parentheses; strings in single quotes; " +
      ":> / :< for numeric and date ranges; null for empty. Fields: email, phone, mobile, company_id, twitter_id, language, time_zone, " +
      "tag, active, created_at, updated_at (dates 'YYYY-MM-DD') and custom contact fields by name. " +
      "Example: \"company_id:42 AND tag:'vip'\". 30 results/page, max 10 pages. Returns { results, total }.",
    {
      query: z.string().describe("Query without the surrounding double quotes."),
      page: z.number().int().min(1).max(10).optional().describe("Result page 1-10."),
    },
    async ({ query, page }) => {
      const q = /^".*"$/s.test(query.trim()) ? query.trim() : `"${query.trim()}"`;
      const res = await fd.get("/search/contacts", { query: q, page });
      return text(res.ok ? res.data : errorPayload("Failed to filter contacts", res));
    },
  );

  tool(
    server,
    "create_contact",
    "Create a contact. Required: name and one of email | phone | mobile | twitter_id | unique_external_id. " +
      "Optional: company_id, other_companies[{company_id, view_all_tickets}], job_title, language, time_zone, address, description, tags[], custom_fields{}.",
    { contact: z.record(z.any()).describe("Contact payload.") },
    async ({ contact }) => {
      const v = validate(ContactCreate, contact);
      if (!v.ok) return v.reply;
      const res = await fd.post("/contacts", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create contact", res));
    },
  );

  tool(
    server,
    "update_contact",
    "Partially update a contact; only sent keys change. Setting tags or other_companies replaces the whole list.",
    { contact_id: contactId, contact: z.record(z.any()).describe("Fields to change.") },
    async ({ contact_id, contact }) => {
      const v = validate(ContactUpdate, contact);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/contacts/${contact_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update contact", res));
    },
  );

  tool(
    server,
    "delete_contact",
    "Soft-delete a contact (moves to Deleted; reversible with restore_contact).",
    { contact_id: contactId },
    async ({ contact_id }) => {
      const res = await fd.delete(`/contacts/${contact_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete contact", res));
    },
  );

  tool(
    server,
    "hard_delete_contact",
    "PERMANENTLY delete a contact and ALL their tickets (GDPR erase). Irreversible. The contact must already be soft-deleted unless force=true.",
    {
      contact_id: contactId,
      force: z.boolean().optional().describe("true = hard-delete even if not soft-deleted first."),
    },
    async ({ contact_id, force }) => {
      const path = force
        ? `/contacts/${contact_id}/hard_delete?force=true`
        : `/contacts/${contact_id}/hard_delete`;
      const res = await fd.delete(path);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to hard-delete contact", res));
    },
  );

  tool(
    server,
    "restore_contact",
    "Restore a soft-deleted contact.",
    { contact_id: contactId },
    async ({ contact_id }) => {
      const res = await fd.put(`/contacts/${contact_id}/restore`);
      if (res.status === 204 || res.ok) return text({ success: true, data: res.data });
      return text(errorPayload("Failed to restore contact", res));
    },
  );

  tool(
    server,
    "list_deleted_contacts",
    "List soft-deleted contacts (shortcut for list_contacts state='deleted').",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/contacts", { state: "deleted", page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list deleted contacts", res));
    },
  );

  tool(
    server,
    "merge_contacts",
    "Merge duplicate contacts into a primary one; secondaries' tickets move to the primary and secondaries are deleted. " +
      "Payload: primary_contact_id, secondary_contact_ids[], contact?{email, phone, mobile, company_ids, other_emails…} to pick final values.",
    { merge: z.record(z.any()).describe("Merge payload.") },
    async ({ merge }) => {
      const v = validate(ContactsMerge, merge);
      if (!v.ok) return v.reply;
      const res = await fd.post("/contacts/merge", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to merge contacts", res));
    },
  );

  tool(
    server,
    "make_agent",
    "Convert a contact (must have an email) into an agent. Optional agent settings: occasional, ticket_scope (1=global 2=group 3=restricted), " +
      "group_ids[], role_ids[], skill_ids[], signature, type ('support_agent' | 'field_agent' | 'collaborator').",
    {
      contact_id: contactId,
      agent: z.record(z.any()).optional().describe("Optional agent settings."),
    },
    async ({ contact_id, agent }) => {
      const payload = agent ?? {};
      const v = validate(MakeAgentFields, payload);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/contacts/${contact_id}/make_agent`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to make agent", res));
    },
  );

  tool(
    server,
    "send_contact_invite",
    "Email a customer-portal activation invite to a contact.",
    { contact_id: contactId },
    async ({ contact_id }) => {
      const res = await fd.put(`/contacts/${contact_id}/send_invite`);
      if (res.status === 204 || res.ok) return text({ success: true });
      return text(errorPayload("Failed to send invite", res));
    },
  );

  // ─── Export / Import ──────────────────────────────
  tool(
    server,
    "export_contacts",
    "Start an async CSV export of all contacts. Returns an export id — poll view_contact_export until it has a download url. " +
      "Use list_contact_fields to discover field names.",
    {
      default_fields: z
        .array(z.string())
        .describe(
          "Default contact fields to export, e.g. ['name','email','phone','company_name'].",
        ),
      custom_fields: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Custom contact field names to export."),
    },
    async ({ default_fields, custom_fields }) => {
      const res = await fd.post("/contacts/export", { fields: { default_fields, custom_fields } });
      return text(res.ok ? res.data : errorPayload("Failed to start contact export", res));
    },
  );

  tool(
    server,
    "view_contact_export",
    "Check a contact export job; when status is 'completed' the response includes the download url.",
    { export_id: z.string().describe("Export id returned by export_contacts.") },
    async ({ export_id }) => {
      const res = await requestFirstOf(["GET", "POST"], `/contacts/export/${export_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view contact export", res));
    },
  );

  tool(
    server,
    "list_contact_imports",
    "List the 5 most recent contact CSV imports (status, record counts, failure report).",
    { status: importStatus },
    async ({ status }) => {
      const res = await fd.get("/contacts/imports", { status });
      return text(res.ok ? res.data : errorPayload("Failed to list contact imports", res));
    },
  );

  tool(
    server,
    "view_contact_import",
    "View a contact import: progress, completion estimate or failures.",
    { import_id: z.number().int().describe("Import ID.") },
    async ({ import_id }) => {
      const res = await fd.get(`/contacts/imports/${import_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view contact import", res));
    },
  );

  tool(
    server,
    "cancel_contact_import",
    "Cancel an in-progress contact import.",
    { import_id: z.number().int().describe("Import ID.") },
    async ({ import_id }) => {
      const res = await fd.put(`/contacts/imports/${import_id}/cancel`);
      return text(
        res.ok
          ? (res.data ?? { success: true })
          : errorPayload("Failed to cancel contact import", res),
      );
    },
  );

  // ─── Contact fields ───────────────────────────────
  const contactFieldId = z.number().int().describe("Contact field ID.");

  tool(
    server,
    "list_contact_fields",
    "List all contact field definitions (system + custom) with names, types and choices.",
    {},
    async () => {
      const res = await fd.get("/contact_fields");
      return text(res.ok ? res.data : errorPayload("Failed to list contact fields", res));
    },
  );

  tool(
    server,
    "view_contact_field",
    "View one contact field definition.",
    { contact_field_id: contactFieldId },
    async ({ contact_field_id }) => {
      const res = await fd.get(`/contact_fields/${contact_field_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view contact field", res));
    },
  );

  tool(
    server,
    "create_contact_field",
    "Admin: create a custom contact field. Required: label, label_for_customers, type ('custom_text' | 'custom_paragraph' | " +
      "'custom_checkbox' | 'custom_number' | 'custom_dropdown' | 'custom_phone_number' | 'custom_url' | 'custom_date'). " +
      "Optional: position, required_for_agents, customers_can_edit, required_for_customers, displayed_for_customers, editable_in_signup, choices[].",
    { contact_field: z.record(z.any()).describe("Contact field payload.") },
    async ({ contact_field }) => {
      const v = validate(ContactFieldCreate, contact_field);
      if (!v.ok) return v.reply;
      const res = await fd.post("/contact_fields", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create contact field", res));
    },
  );

  tool(
    server,
    "update_contact_field",
    "Admin: update a contact field; only sent keys change.",
    {
      contact_field_id: contactFieldId,
      contact_field: z.record(z.any()).describe("Fields to change."),
    },
    async ({ contact_field_id, contact_field }) => {
      const v = validate(ContactFieldUpdate, contact_field);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/contact_fields/${contact_field_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update contact field", res));
    },
  );

  tool(
    server,
    "delete_contact_field",
    "Admin: delete a custom contact field.",
    { contact_field_id: contactFieldId },
    async ({ contact_field_id }) => {
      const res = await fd.delete(`/contact_fields/${contact_field_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete contact field", res));
    },
  );
}
