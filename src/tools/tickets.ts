import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd, parseLinkHeader, requestFirstOf } from "../freshdesk.js";
import {
  ConversationUpdate,
  NoteCreate,
  ReplyCreate,
  ReplyToForwardCreate,
  TicketBulkDeleteAction,
  TicketBulkUpdateAction,
  TicketCreate,
  TicketFieldCreate,
  TicketFieldUpdate,
  TicketForward,
  TicketMerge,
  TicketUpdate,
} from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

const ticketId = z.number().int().describe("Freshdesk ticket ID (the numeric display ID).");
const ENUMS_HINT =
  "status: 2=Open 3=Pending 4=Resolved 5=Closed; priority: 1=Low 2=Medium 3=High 4=Urgent; " +
  "source: 1=Email 2=Portal 3=Phone 7=Chat 9=Feedback widget 10=Outbound email.";

const CONVO_HINT =
  "Output: { conversations, total_returned, pages_fetched, truncated, next_page }; " +
  "with fetch_all=false a single page plus pagination{current_page, next_page, prev_page, per_page}.";

const conversationArgs = {
  page: z.number().int().min(1).optional().default(1).describe("First page to fetch."),
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(100)
    .describe("Conversations per page (max 100)."),
  fetch_all: z
    .boolean()
    .optional()
    .default(true)
    .describe("Follow pagination until the last page (default true)."),
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(20)
    .describe("Safety cap on pages fetched when fetch_all=true."),
};

/** Fetch ticket conversations, following the Link header so long threads aren't silently cut at one page. */
export async function fetchConversations(
  path: string,
  args: { page: number; per_page: number; fetch_all: boolean; max_pages: number },
) {
  const { page, per_page, fetch_all, max_pages } = args;
  const conversations: any[] = [];
  let next: number | null = page;
  let prev: number | null = null;
  let pages = 0;
  while (next !== null && pages < (fetch_all ? max_pages : 1)) {
    const res = await fd.get(path, { page: next, per_page });
    if (!res.ok) return { ok: false as const, page: next, res };
    if (Array.isArray(res.data)) conversations.push(...res.data);
    const link = parseLinkHeader(res.headers.get("link"));
    if (pages === 0) prev = link.prev;
    next = link.next;
    pages++;
  }
  return { ok: true as const, conversations, pages, next, prev };
}

export async function listConversations(
  path: string,
  args: { page: number; per_page: number; fetch_all: boolean; max_pages: number },
  errorPrefix: string,
) {
  const r = await fetchConversations(path, args);
  if (!r.ok) return text(errorPayload(`${errorPrefix} (page ${r.page})`, r.res));
  const { conversations, pages, next, prev } = r;
  if (!args.fetch_all) {
    return text({
      conversations,
      pagination: {
        current_page: args.page,
        next_page: next,
        prev_page: prev,
        per_page: args.per_page,
      },
    });
  }
  return text({
    conversations,
    total_returned: conversations.length,
    pages_fetched: pages,
    truncated: next !== null,
    next_page: next,
  });
}

export function registerTicketTools(server: McpServer) {
  tool(
    server,
    "get_ticket_fields",
    "List every ticket field (system + custom) with its name, label, type and allowed choices. " +
      "Call this before create/update/search when you need the API name of a custom field (e.g. 'cf_order_id') or valid dropdown values.",
    {},
    async () => {
      const res = await fd.get("/ticket_fields");
      return text(res.ok ? res.data : errorPayload("Failed to fetch ticket fields", res));
    },
  );

  tool(
    server,
    "get_tickets",
    "List tickets, newest first by default. Without filters Freshdesk only returns tickets created in the last 30 days " +
      "(use updated_since for older ones) and caps results at 300 pages. Deleted/spam tickets are excluded unless filter='deleted'/'spam'. " +
      "For field-based queries (status, priority, tags, custom fields, date ranges) prefer search_tickets. Returns { tickets, pagination }.",
    {
      ...pageArgs,
      filter: z
        .enum(["new_and_my_open", "watching", "spam", "deleted"])
        .optional()
        .describe("Predefined view."),
      requester_id: z.number().int().optional().describe("Only tickets from this contact ID."),
      email: z.string().email().optional().describe("Only tickets from this requester email."),
      unique_external_id: z
        .string()
        .optional()
        .describe("Only tickets from the requester with this unique_external_id."),
      company_id: z.number().int().optional().describe("Only tickets for this company ID."),
      updated_since: z
        .string()
        .optional()
        .describe("ISO-8601 UTC timestamp, e.g. '2025-01-19T02:00:00Z'."),
      order_by: z
        .enum(["created_at", "due_by", "updated_at", "status"])
        .optional()
        .describe("Sort field (default created_at)."),
      order_type: z.enum(["asc", "desc"]).optional().describe("Sort direction (default desc)."),
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated embeds: 'stats' (closed/resolved/first_responded times), 'requester', 'description'. Each costs 2 extra API credits.",
        ),
    },
    async (args) => {
      const { page, per_page, ...rest } = args;
      const res = await fd.get("/tickets", { page, per_page, ...rest });
      if (!res.ok) return text(errorPayload("Failed to fetch tickets", res));
      const pagination = parseLinkHeader(res.headers.get("link"));
      return text({
        tickets: res.data,
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
    "get_ticket",
    "Get one ticket by ID. The description and conversations are not always included by default; use include to embed them.",
    {
      ticket_id: ticketId,
      include: z
        .string()
        .optional()
        .describe(
          "Comma-separated embeds: 'conversations' (first 10, +2 credits), 'requester', 'company', 'stats'.",
        ),
    },
    async ({ ticket_id, include }) => {
      const res = await fd.get(`/tickets/${ticket_id}`, { include });
      return text(res.ok ? res.data : errorPayload("Failed to fetch ticket", res));
    },
  );

  tool(
    server,
    "create_ticket",
    "Create a ticket. Required: a requester identifier (email | requester_id | phone | twitter_id | facebook_id | unique_external_id) " +
      "and subject/description. Common fields: subject, description (HTML), status, priority, source, type, group_id, responder_id, " +
      `company_id, product_id, email_config_id, internal_agent_id, internal_group_id, tags[], cc_emails[], custom_fields{cf_*}, due_by, fr_due_by, ` +
      `lookup_parameter, parent_id (create as child), related_ticket_ids[] (create as tracker). ${ENUMS_HINT} ` +
      "Note 'type' is a top-level field, not a custom field. File attachments need multipart upload and are not supported here.",
    { ticket: z.record(z.any()).describe("Ticket payload as a JSON object.") },
    async ({ ticket }) => {
      const v = validate(TicketCreate, ticket);
      if (!v.ok) return v.reply;
      const res = await fd.post("/tickets", v.data);
      if (res.status === 201) return text({ success: true, ticket: res.data });
      return text(errorPayload("Failed to create ticket", res));
    },
  );

  tool(
    server,
    "update_ticket",
    `Partially update a ticket — only the keys you send change (status, priority, responder_id, group_id, tags, custom_fields, ...). ${ENUMS_HINT} ` +
      "Setting tags replaces the whole tag list. To change internal_agent_id/internal_group_id you must also send status.",
    {
      ticket_id: ticketId,
      ticket: z.record(z.any()).describe("Fields to change."),
    },
    async ({ ticket_id, ticket }) => {
      if (!ticket || Object.keys(ticket).length === 0) return text({ error: "No fields provided" });
      const v = validate(TicketUpdate, ticket);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/tickets/${ticket_id}`, v.data);
      return text(
        res.ok ? { success: true, ticket: res.data } : errorPayload("Failed to update ticket", res),
      );
    },
  );

  tool(
    server,
    "delete_ticket",
    "Move a ticket to Trash (soft delete). Reversible with restore_ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.delete(`/tickets/${ticket_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete ticket", res));
    },
  );

  tool(
    server,
    "restore_ticket",
    "Restore a soft-deleted ticket from Trash.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.put(`/tickets/${ticket_id}/restore`);
      if (res.status === 204) return text({ success: true });
      return text(res.ok ? res.data : errorPayload("Failed to restore ticket", res));
    },
  );

  tool(
    server,
    "search_tickets",
    "Filter tickets with Freshdesk query language. Syntax: field:value joined by AND/OR with parentheses; strings in single quotes; " +
      "numeric/date ranges with :> and :< ; null for empty. Fields: agent_id, group_id, priority, status, tag, type, due_by, fr_due_by, " +
      "created_at, updated_at, closed_at (dates as 'YYYY-MM-DD'), plus custom fields by name (without cf_ prefix). " +
      "Example: \"status:2 AND priority:>3 AND tag:'vip'\". Max 512 chars, 30 results/page, max 10 pages. Archived tickets excluded; index lags a few minutes. " +
      "Returns { results, total }.",
    {
      query: z
        .string()
        .describe("Query without the surrounding double quotes (they're added automatically)."),
      page: z.number().int().min(1).max(10).optional().describe("Result page 1-10."),
    },
    async ({ query, page }) => {
      const q = /^".*"$/s.test(query.trim()) ? query.trim() : `"${query.trim()}"`;
      const res = await fd.get("/search/tickets", { query: q, page });
      return text(res.ok ? res.data : errorPayload("Failed to search tickets", res));
    },
  );

  // ─── Conversations ────────────────────────────────
  tool(
    server,
    "get_ticket_conversation",
    "List replies and notes on a ticket, oldest first (body, private flag, from/to emails, attachments). " +
      `By default fetches every page so the full thread is returned; check 'truncated' in the result. ${CONVO_HINT} ` +
      "Read this before drafting a reply so the response fits the thread.",
    { ticket_id: ticketId, ...conversationArgs },
    async ({ ticket_id, ...args }) =>
      listConversations(
        `/tickets/${ticket_id}/conversations`,
        args,
        "Failed to fetch conversation",
      ),
  );

  tool(
    server,
    "create_ticket_reply",
    "Send a public reply to the requester (emails them). Payload: body (HTML, required), optional cc_emails[], bcc_emails[], " +
      "from_email (must be a configured support email), user_id (agent sending). Use create_ticket_note for internal comments. " +
      "File attachments (multipart) are not supported.",
    {
      ticket_id: ticketId,
      reply: z.record(z.any()).describe("Reply payload, e.g. { body: '<p>Hi…</p>' }."),
    },
    async ({ ticket_id, reply }) => {
      const v = validate(ReplyCreate, reply);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/reply`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create reply", res));
    },
  );

  tool(
    server,
    "create_ticket_note",
    "Add a note to a ticket. Payload: body (HTML, required), private (default true — internal, not visible to requester), " +
      "notify_emails[] (agent emails to notify), incoming (true = appears as from the requester), user_id. " +
      "File attachments (multipart) are not supported.",
    {
      ticket_id: ticketId,
      note: z.record(z.any()).describe("Note payload, e.g. { body: '…', private: true }."),
    },
    async ({ ticket_id, note }) => {
      const v = validate(NoteCreate, note);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/notes`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create note", res));
    },
  );

  tool(
    server,
    "update_ticket_conversation",
    "Edit the body of an existing note (replies that were already emailed cannot be changed). Payload: { body }.",
    {
      conversation_id: z
        .number()
        .int()
        .describe("Conversation (note) ID from get_ticket_conversation."),
      conversation: z.record(z.any()).describe("{ body: '<new HTML>' }"),
    },
    async ({ conversation_id, conversation }) => {
      const v = validate(ConversationUpdate, conversation);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/conversations/${conversation_id}`, v.data);
      if (res.status === 200) return text(res.data);
      return text(errorPayload("Cannot update conversation", res));
    },
  );

  tool(
    server,
    "delete_conversation",
    "Permanently delete a note/reply from a ticket. Irreversible.",
    { conversation_id: z.number().int().describe("Conversation ID.") },
    async ({ conversation_id }) => {
      const res = await fd.delete(`/conversations/${conversation_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete conversation", res));
    },
  );

  tool(
    server,
    "forward_ticket",
    "Forward a ticket by email to third parties. Required: body (HTML), to_emails[]. Optional: body_text, cc_emails[], bcc_emails[], " +
      "from_email, agent_id, include_quoted_text, include_original_attachments.",
    { ticket_id: ticketId, forward: z.record(z.any()).describe("Forward payload.") },
    async ({ ticket_id, forward }) => {
      const v = validate(TicketForward, forward);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/forward`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to forward ticket", res));
    },
  );

  tool(
    server,
    "reply_to_forward",
    "Reply to a third party on a previously forwarded thread. Required: body (HTML), to_emails[]. Optional: body_text, user_id.",
    {
      ticket_id: ticketId,
      reply: z.record(z.any()).describe("{ body, to_emails, body_text?, user_id? }"),
    },
    async ({ ticket_id, reply }) => {
      const v = validate(ReplyToForwardCreate, reply);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/reply_to_forward`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to reply to forward", res));
    },
  );

  tool(
    server,
    "delete_attachment",
    "Permanently delete an attachment (from a ticket, conversation, etc.) by attachment ID. Irreversible.",
    {
      attachment_id: z
        .number()
        .int()
        .describe("Attachment ID (from a ticket/conversation 'attachments' array)."),
    },
    async ({ attachment_id }) => {
      const res = await fd.delete(`/attachments/${attachment_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete attachment", res));
    },
  );

  // ─── Summary ──────────────────────────────────────
  tool(
    server,
    "view_ticket_summary",
    "Get the agent-written/AI summary attached to a ticket, if any.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/summary`);
      return text(res.ok ? res.data : errorPayload("Failed to fetch summary", res));
    },
  );

  tool(
    server,
    "update_ticket_summary",
    "Create or replace a ticket's summary.",
    { ticket_id: ticketId, body: z.string().describe("Summary content (HTML allowed).") },
    async ({ ticket_id, body }) => {
      const res = await fd.put(`/tickets/${ticket_id}/summary`, { body });
      return text(res.ok ? res.data : errorPayload("Failed to update summary", res));
    },
  );

  tool(
    server,
    "delete_ticket_summary",
    "Remove a ticket's summary.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.delete(`/tickets/${ticket_id}/summary`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete summary", res));
    },
  );

  // ─── Ticket fields (admin) ────────────────────────
  const fieldId = z.number().int().describe("Ticket field ID (from get_ticket_fields).");

  tool(
    server,
    "get_field_properties",
    "Get one ticket field definition by API name (e.g. 'status', 'priority', 'type', 'cf_region'), including its choices. " +
      "Cheaper to reason about than the full get_ticket_fields list.",
    { field_name: z.string().describe("Field API name. 'type' is mapped to 'ticket_type'.") },
    async ({ field_name }) => {
      const actual = field_name === "type" ? "ticket_type" : field_name;
      const res = await fd.get("/ticket_fields");
      if (!res.ok) return text(errorPayload("Failed to fetch ticket fields", res));
      const match = Array.isArray(res.data) ? res.data.find((f: any) => f.name === actual) : null;
      return text(match ?? { error: `Field '${field_name}' not found` });
    },
  );

  tool(
    server,
    "view_ticket_field",
    "Admin: view a ticket field with full configuration (choices, sections, portal settings).",
    { ticket_field_id: fieldId },
    async ({ ticket_field_id }) => {
      const res = await fd.get(`/admin/ticket_fields/${ticket_field_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to fetch ticket field", res));
    },
  );

  tool(
    server,
    "create_ticket_field",
    "Admin: create a custom ticket field. Required: label, type ('custom_text' | 'custom_paragraph' | 'custom_checkbox' | 'custom_number' | " +
      "'custom_decimal' | 'custom_date' | 'custom_dropdown' | 'nested_field'). Optional: label_for_customers, required_for_agents, " +
      "required_for_customers, required_for_closure, displayed_to_customers, customers_can_edit, position, choices[], " +
      "dependent_fields[] (nested_field levels), section_mappings[].",
    { ticket_field: z.record(z.any()).describe("Ticket field payload.") },
    async ({ ticket_field }) => {
      const v = validate(TicketFieldCreate, ticket_field);
      if (!v.ok) return v.reply;
      const res = await fd.post("/admin/ticket_fields", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create ticket field", res));
    },
  );

  tool(
    server,
    "update_ticket_field",
    "Admin: update a ticket field (label, required flags, position, choices…). Only sent keys change.",
    { ticket_field_id: fieldId, ticket_field: z.record(z.any()).describe("Fields to change.") },
    async ({ ticket_field_id, ticket_field }) => {
      const v = validate(TicketFieldUpdate, ticket_field);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/admin/ticket_fields/${ticket_field_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update ticket field", res));
    },
  );

  tool(
    server,
    "delete_ticket_field",
    "Admin: delete a custom ticket field. Data stored in it becomes inaccessible.",
    { ticket_field_id: fieldId },
    async ({ ticket_field_id }) => {
      const res = await fd.delete(`/admin/ticket_fields/${ticket_field_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete ticket field", res));
    },
  );

  // ─── Ticket field sections (dynamic sections) ─────
  const sectionId = z.number().int().describe("Section ID.");
  const sectionBody = {
    label: z.string().describe("Section name."),
    choice_ids: z
      .array(z.number().int())
      .describe("Dropdown choice IDs of the parent field that reveal this section."),
  };

  tool(
    server,
    "list_ticket_field_sections",
    "Admin: list dynamic sections of a dropdown ticket field (sections show extra fields when a given choice is selected).",
    { ticket_field_id: fieldId },
    async ({ ticket_field_id }) => {
      const res = await fd.get(`/admin/ticket_fields/${ticket_field_id}/sections`);
      return text(res.ok ? res.data : errorPayload("Failed to list sections", res));
    },
  );

  tool(
    server,
    "view_ticket_field_section",
    "Admin: view one dynamic section of a ticket field.",
    { ticket_field_id: fieldId, section_id: sectionId },
    async ({ ticket_field_id, section_id }) => {
      const res = await fd.get(`/admin/ticket_fields/${ticket_field_id}/sections/${section_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view section", res));
    },
  );

  tool(
    server,
    "create_ticket_field_section",
    "Admin: create a dynamic section on a dropdown ticket field.",
    { ticket_field_id: fieldId, ...sectionBody },
    async ({ ticket_field_id, label, choice_ids }) => {
      const res = await fd.post(`/admin/ticket_fields/${ticket_field_id}/sections`, {
        label,
        choice_ids,
      });
      return text(res.ok ? res.data : errorPayload("Failed to create section", res));
    },
  );

  tool(
    server,
    "update_ticket_field_section",
    "Admin: rename a dynamic section or change which choices reveal it.",
    {
      ticket_field_id: fieldId,
      section_id: sectionId,
      label: sectionBody.label.optional(),
      choice_ids: sectionBody.choice_ids.optional(),
    },
    async ({ ticket_field_id, section_id, ...body }) => {
      const res = await fd.put(
        `/admin/ticket_fields/${ticket_field_id}/sections/${section_id}`,
        body,
      );
      return text(res.ok ? res.data : errorPayload("Failed to update section", res));
    },
  );

  tool(
    server,
    "delete_ticket_field_section",
    "Admin: delete a dynamic section from a ticket field.",
    { ticket_field_id: fieldId, section_id: sectionId },
    async ({ ticket_field_id, section_id }) => {
      const res = await fd.delete(`/admin/ticket_fields/${ticket_field_id}/sections/${section_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete section", res));
    },
  );

  // ─── Ticket forms (customer portal forms) ─────────
  const formId = z.number().int().describe("Ticket form ID.");

  tool(
    server,
    "list_ticket_forms",
    "List ticket forms shown in the customer portal.",
    {},
    async () => {
      const res = await fd.get("/ticket-forms");
      return text(res.ok ? res.data : errorPayload("Failed to list ticket forms", res));
    },
  );

  tool(
    server,
    "view_ticket_form",
    "View a ticket form with its fields.",
    { form_id: formId },
    async ({ form_id }) => {
      const res = await fd.get(`/ticket-forms/${form_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view ticket form", res));
    },
  );

  tool(
    server,
    "create_ticket_form",
    "Create a portal ticket form. Payload: title (required), description, fields[] (required; must include the requester and company fields). " +
      "Each field: { id (ticket field ID), label_for_customers, customers_can_edit, required_for_customers, placeholder_for_customers, hint_for_customers, position? }.",
    { form: z.record(z.any()).describe("Ticket form payload.") },
    async ({ form }) => {
      const res = await fd.post("/ticket-forms", form);
      return text(res.ok ? res.data : errorPayload("Failed to create ticket form", res));
    },
  );

  tool(
    server,
    "update_ticket_form",
    "Update a ticket form's title, description or fields[] (same field shape as create_ticket_form).",
    { form_id: formId, form: z.record(z.any()).describe("Fields to change.") },
    async ({ form_id, form }) => {
      const res = await fd.put(`/ticket-forms/${form_id}`, form);
      return text(res.ok ? res.data : errorPayload("Failed to update ticket form", res));
    },
  );

  tool(
    server,
    "delete_ticket_form",
    "Delete a ticket form.",
    { form_id: formId },
    async ({ form_id }) => {
      const res = await fd.delete(`/ticket-forms/${form_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete ticket form", res));
    },
  );

  tool(
    server,
    "clone_ticket_form",
    "Duplicate a ticket form (creates 'Copy of …' with the same fields).",
    { form_id: formId },
    async ({ form_id }) => {
      const res = await fd.get(`/ticket-forms/${form_id}/clone`);
      return text(res.ok ? res.data : errorPayload("Failed to clone ticket form", res));
    },
  );

  tool(
    server,
    "view_ticket_form_field",
    "View how one ticket field is configured inside a ticket form.",
    { form_id: formId, field_id: fieldId },
    async ({ form_id, field_id }) => {
      const res = await fd.get(`/ticket-forms/${form_id}/fields/${field_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view form field", res));
    },
  );

  tool(
    server,
    "update_ticket_form_field",
    "Update a field inside a ticket form. Payload: label_for_customers, customers_can_edit, required_for_customers, hint_for_customers, " +
      "placeholder_for_customers, position.",
    {
      form_id: formId,
      field_id: fieldId,
      field: z.record(z.any()).describe("Form field settings."),
    },
    async ({ form_id, field_id, field }) => {
      const res = await requestFirstOf(
        ["PUT", "POST"],
        `/ticket-forms/${form_id}/fields/${field_id}`,
        field,
      );
      return text(res.ok ? res.data : errorPayload("Failed to update form field", res));
    },
  );

  tool(
    server,
    "delete_ticket_form_field",
    "Remove a field from a ticket form (the ticket field itself is kept).",
    { form_id: formId, field_id: fieldId },
    async ({ form_id, field_id }) => {
      const res = await fd.delete(`/ticket-forms/${form_id}/fields/${field_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete form field", res));
    },
  );

  // ─── Bulk ─────────────────────────────────────────
  tool(
    server,
    "bulk_create_tickets",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Create up to 100 tickets in one asynchronous job (same payload shape as create_ticket). Returns a job_id — poll view_job_status.",
    { tickets: z.array(z.record(z.any())).min(1).max(100).describe("Ticket payloads.") },
    async ({ tickets }) => {
      const validated: any[] = [];
      for (let i = 0; i < tickets.length; i++) {
        const v = validate(TicketCreate, tickets[i]);
        if (!v.ok)
          return text({
            error: `Ticket at index ${i} failed validation`,
            issues: (v.reply.content[0] as any).text,
          });
        validated.push(v.data);
      }
      const res = await fd.post("/tickets/bulk_create", { tickets: validated });
      return text(res.ok ? res.data : errorPayload("Failed to bulk create tickets", res));
    },
  );

  tool(
    server,
    "bulk_update_tickets",
    "Update up to 100 tickets asynchronously. Payload: { ids: number[], properties?: {status, priority, source, type, group_id, responder_id, " +
      "product_id, email_config_id, requester_id, parent_id, due_by, fr_due_by, tags, custom_fields, internal_agent_id, internal_group_id, " +
      "skip_close_notification…}, reply?: { body, from_email? } }. Changing internal agent/group also requires status. Returns a job_id — poll view_job_status.",
    { bulk_action: z.record(z.any()).describe("{ ids, properties?, reply? }") },
    async ({ bulk_action }) => {
      const v = validate(TicketBulkUpdateAction, bulk_action);
      if (!v.ok) return v.reply;
      const res = await fd.post("/tickets/bulk_update", { bulk_action: v.data });
      return text(res.ok ? res.data : errorPayload("Failed to bulk update tickets", res));
    },
  );

  tool(
    server,
    "bulk_delete_tickets",
    "Soft-delete up to 100 tickets asynchronously. Payload: { ids: number[] }. Returns a job_id — poll view_job_status.",
    { bulk_action: z.record(z.any()).describe("{ ids: number[] }") },
    async ({ bulk_action }) => {
      const v = validate(TicketBulkDeleteAction, bulk_action);
      if (!v.ok) return v.reply;
      const res = await fd.post("/tickets/bulk_delete", { bulk_action: v.data });
      return text(res.ok ? res.data : errorPayload("Failed to bulk delete tickets", res));
    },
  );

  tool(
    server,
    "merge_tickets",
    "Merge secondary tickets into a primary one (secondaries are closed). Payload: primary_id, ticket_ids[], " +
      "note_in_primary?{body,private}, note_in_secondary?{body,private}, convert_recepients_to_cc? (Freshdesk's spelling).",
    { merge: z.record(z.any()).describe("Merge payload.") },
    async ({ merge }) => {
      const v = validate(TicketMerge, merge);
      if (!v.ok) return v.reply;
      const res = await fd.put("/tickets/merge", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to merge tickets", res));
    },
  );

  // ─── Archived ─────────────────────────────────────
  tool(
    server,
    "list_archived_tickets",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. List archived tickets (closed tickets moved out of the active list; not returned by get_tickets/search_tickets).",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/tickets/archived", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list archived tickets", res));
    },
  );

  tool(
    server,
    "view_archived_ticket",
    "View an archived ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/archived/${ticket_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view archived ticket", res));
    },
  );

  tool(
    server,
    "list_archived_ticket_conversations",
    `List replies and notes on an archived ticket, oldest first. Fetches every page by default. ${CONVO_HINT}`,
    { ticket_id: ticketId, ...conversationArgs },
    async ({ ticket_id, ...args }) =>
      listConversations(
        `/tickets/archived/${ticket_id}/conversations`,
        args,
        "Failed to list archived conversations",
      ),
  );

  tool(
    server,
    "delete_archived_ticket",
    "Permanently delete an archived ticket. Irreversible.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.delete(`/tickets/archived/${ticket_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete archived ticket", res));
    },
  );

  // ─── Watchers ─────────────────────────────────────
  tool(
    server,
    "list_ticket_watchers",
    "List agent IDs watching a ticket (watchers get notified of updates).",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/watchers`);
      return text(res.ok ? res.data : errorPayload("Failed to list watchers", res));
    },
  );

  tool(
    server,
    "add_ticket_watcher",
    "Add an agent as a watcher on a ticket.",
    { ticket_id: ticketId, user_id: z.number().int().describe("Agent ID to add as watcher.") },
    async ({ ticket_id, user_id }) => {
      const res = await fd.post(`/tickets/${ticket_id}/watch`, { user_id });
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to add watcher", res));
    },
  );

  tool(
    server,
    "remove_ticket_watcher",
    "Stop watching a ticket as the API-key owner (Freshdesk only lets the current agent unwatch).",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.put(`/tickets/${ticket_id}/unwatch`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to remove watcher", res));
    },
  );

  tool(
    server,
    "bulk_watch_tickets",
    "Add one agent as watcher on many tickets (defaults to the API-key owner).",
    {
      ids: z.array(z.number().int()).min(1).describe("Ticket IDs."),
      user_id: z.number().int().optional().describe("Agent ID; omit for the current agent."),
    },
    async (body) => {
      const res = await fd.put("/tickets/bulk_watch", body);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to bulk watch", res));
    },
  );

  tool(
    server,
    "bulk_unwatch_tickets",
    "Stop watching many tickets as the API-key owner.",
    { ids: z.array(z.number().int()).min(1).describe("Ticket IDs.") },
    async (body) => {
      const res = await fd.put("/tickets/bulk_unwatch", body);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to bulk unwatch", res));
    },
  );

  // ─── Associations (parent/child, tracker/related) ─
  tool(
    server,
    "get_associated_tickets",
    "List tickets associated with a ticket: children of a parent, or related tickets of a tracker. " +
      "To create associations, pass parent_id (child) or related_ticket_ids/association_type on create_ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/associated_tickets`);
      return text(res.ok ? res.data : errorPayload("Failed to get associated tickets", res));
    },
  );

  tool(
    server,
    "get_prime_association",
    "Get the prime (parent or tracker) ticket of a child/related ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/prime_association`);
      return text(res.ok ? res.data : errorPayload("Failed to get prime association", res));
    },
  );

  // ─── User access (share a ticket with contacts) ───
  tool(
    server,
    "list_ticket_accesses",
    "List user IDs (besides the requester) that were given access to view a ticket in the portal.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/accesses`);
      return text(res.ok ? res.data : errorPayload("Failed to list ticket accesses", res));
    },
  );

  tool(
    server,
    "add_ticket_accesses",
    "Give users (contacts) access to view a ticket in the portal.",
    {
      ticket_id: ticketId,
      user_ids: z.array(z.number().int()).min(1).describe("User IDs to grant."),
    },
    async ({ ticket_id, user_ids }) => {
      const res = await fd.post(`/tickets/${ticket_id}/accesses`, { user_ids });
      return text(res.ok ? res.data : errorPayload("Failed to add ticket accesses", res));
    },
  );

  tool(
    server,
    "update_ticket_accesses",
    "Grant and/or revoke ticket access for specific users in one call.",
    {
      ticket_id: ticketId,
      add: z.array(z.number().int()).optional().default([]).describe("User IDs to grant."),
      remove: z.array(z.number().int()).optional().default([]).describe("User IDs to revoke."),
    },
    async ({ ticket_id, add, remove }) => {
      if (add.length + remove.length === 0) return text({ error: "Provide add and/or remove" });
      const user_ids = [
        ...add.map((id) => ({ id })),
        ...remove.map((id) => ({ id, deleted: true })),
      ];
      const res = await fd.patch(`/tickets/${ticket_id}/accesses`, { user_ids });
      return text(res.ok ? res.data : errorPayload("Failed to update ticket accesses", res));
    },
  );

  tool(
    server,
    "remove_ticket_accesses",
    "Revoke ALL extra user access on a ticket (requester keeps access).",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.delete(`/tickets/${ticket_id}/accesses`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to remove ticket accesses", res));
    },
  );

  // ─── Related lists ────────────────────────────────
  tool(
    server,
    "list_ticket_time_entries",
    "List time entries logged on a ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/time_entries`);
      return text(res.ok ? res.data : errorPayload("Failed to list time entries", res));
    },
  );

  tool(
    server,
    "list_ticket_satisfaction_ratings",
    "List CSAT ratings submitted for a ticket.",
    { ticket_id: ticketId },
    async ({ ticket_id }) => {
      const res = await fd.get(`/tickets/${ticket_id}/satisfaction_ratings`);
      return text(res.ok ? res.data : errorPayload("Failed to list satisfaction ratings", res));
    },
  );

  tool(
    server,
    "list_ticket_enums",
    "Return the numeric codes Freshdesk uses for ticket source, status and priority. No API call.",
    {},
    async () =>
      text({
        source: { Email: 1, Portal: 2, Phone: 3, Chat: 7, FeedbackWidget: 9, OutboundEmail: 10 },
        status: { Open: 2, Pending: 3, Resolved: 4, Closed: 5 },
        priority: { Low: 1, Medium: 2, High: 3, Urgent: 4 },
      }),
  );
}
