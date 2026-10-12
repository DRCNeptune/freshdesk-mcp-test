import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd } from "../freshdesk.js";
import {
  MailboxCreate,
  MailboxUpdate,
  SkillCreate,
  SkillUpdate,
  ThreadCreate,
  ThreadMessageCreate,
  ThreadMessageUpdate,
  ThreadUpdate,
  TimeEntryCreate,
  TimeEntryUpdate,
} from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

// ─── Skills (Omni skill-based routing) ───────────
const skillId = z.number().int().describe("Skill ID.");
const SKILL_FIELDS =
  "name, rank, agents[{id}], match_type ('all'|'any'), conditions[{resource_type:'ticket'|'contact'|'company', field_name, operator ('in'|'not_in'|'is'|'is_not'), value[]}]";

export function registerSkillTools(server: McpServer) {
  tool(
    server,
    "list_skills",
    "List routing skills (used by skill-based ticket assignment) with their matching conditions and agents.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/admin/skills", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list skills", res));
    },
  );
  tool(
    server,
    "view_skill",
    "Get one routing skill.",
    { skill_id: skillId },
    async ({ skill_id }) => {
      const res = await fd.get(`/admin/skills/${skill_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view skill", res));
    },
  );
  tool(
    server,
    "create_skill",
    `Create a routing skill. Required: name. Fields: ${SKILL_FIELDS}.`,
    { skill: z.record(z.any()).describe("Skill payload.") },
    async ({ skill }) => {
      const v = validate(SkillCreate, skill);
      if (!v.ok) return v.reply;
      const res = await fd.post("/admin/skills", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create skill", res));
    },
  );
  tool(
    server,
    "update_skill",
    `Update a routing skill; only sent keys change. Fields: ${SKILL_FIELDS}.`,
    { skill_id: skillId, skill: z.record(z.any()).describe("Fields to change.") },
    async ({ skill_id, skill }) => {
      const v = validate(SkillUpdate, skill);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/admin/skills/${skill_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update skill", res));
    },
  );
  tool(
    server,
    "delete_skill",
    "Delete a routing skill.",
    { skill_id: skillId },
    async ({ skill_id }) => {
      const res = await fd.delete(`/admin/skills/${skill_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete skill", res));
    },
  );
}

// ─── Roles ───────────────────────────────────────
export function registerRoleTools(server: McpServer) {
  tool(
    server,
    "list_roles",
    "List agent roles (Account Admin, Admin, Supervisor, Agent, custom…). Use the IDs in agent role_ids.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/roles", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list roles", res));
    },
  );
  tool(
    server,
    "view_role",
    "Get one agent role.",
    { role_id: z.number().int().describe("Role ID.") },
    async ({ role_id }) => {
      const res = await fd.get(`/roles/${role_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view role", res));
    },
  );
}

// ─── Products ────────────────────────────────────
export function registerProductTools(server: McpServer) {
  tool(
    server,
    "list_products",
    "List products (brands) configured in a multi-product helpdesk. Use the IDs in ticket product_id.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/products", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list products", res));
    },
  );
  tool(
    server,
    "view_product",
    "Get one product.",
    { product_id: z.number().int().describe("Product ID.") },
    async ({ product_id }) => {
      const res = await fd.get(`/products/${product_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view product", res));
    },
  );
}

// ─── Business Hours ──────────────────────────────
export function registerBusinessHoursTools(server: McpServer) {
  tool(
    server,
    "list_business_hours",
    "List business-hour calendars (working hours, time zone, holidays) used by SLA and groups.",
    {},
    async () => {
      const res = await fd.get("/business_hours");
      return text(res.ok ? res.data : errorPayload("Failed to list business hours", res));
    },
  );
  tool(
    server,
    "view_business_hours",
    "Get one business-hour calendar with its weekly schedule and holidays.",
    { business_hours_id: z.number().int().describe("Business hours ID.") },
    async ({ business_hours_id }) => {
      const res = await fd.get(`/business_hours/${business_hours_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view business hours", res));
    },
  );
}

// ─── SLA Policies ────────────────────────────────
const SLA_FIELDS =
  "name, description, active, position, is_default, " +
  "sla_target{priority_1..priority_4: {respond_within, resolve_within (seconds), business_hours, escalation_enabled}}, " +
  "applicable_to{company_ids[], group_ids[], sources[], ticket_types[], product_ids[]}, escalation{response, resolution}";

export function registerSlaTools(server: McpServer) {
  tool(
    server,
    "list_sla_policies",
    "List SLA policies: response/resolution targets per priority and the conditions they apply to.",
    {},
    async () => {
      const res = await fd.get("/sla_policies");
      return text(res.ok ? res.data : errorPayload("Failed to list SLA policies", res));
    },
  );
  tool(
    server,
    "view_sla_policy",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Get one SLA policy.",
    { sla_policy_id: z.number().int().describe("SLA policy ID.") },
    async ({ sla_policy_id }) => {
      const res = await fd.get(`/sla_policies/${sla_policy_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view SLA policy", res));
    },
  );
  tool(
    server,
    "create_sla_policy",
    `Create an SLA policy. Required: name, sla_target, applicable_to. Fields: ${SLA_FIELDS}.`,
    { sla_policy: z.record(z.any()).describe("SLA policy payload.") },
    async ({ sla_policy }) => {
      const res = await fd.post("/sla_policies", sla_policy);
      return text(res.ok ? res.data : errorPayload("Failed to create SLA policy", res));
    },
  );
  tool(
    server,
    "update_sla_policy",
    `Update an SLA policy (applicable_to must be sent for non-default policies). Fields: ${SLA_FIELDS}.`,
    {
      sla_policy_id: z.number().int().describe("SLA policy ID."),
      sla_policy: z.record(z.any()).describe("Fields to change."),
    },
    async ({ sla_policy_id, sla_policy }) => {
      const res = await fd.put(`/sla_policies/${sla_policy_id}`, sla_policy);
      return text(res.ok ? res.data : errorPayload("Failed to update SLA policy", res));
    },
  );
}

// ─── Email Configs ───────────────────────────────
export function registerEmailConfigTools(server: McpServer) {
  tool(
    server,
    "list_email_configs",
    "List support email addresses (email configs). Use an ID as email_config_id when creating outbound emails/tickets.",
    {},
    async () => {
      const res = await fd.get("/email_configs");
      return text(res.ok ? res.data : errorPayload("Failed to list email configs", res));
    },
  );
  tool(
    server,
    "view_email_config",
    "Get one email config.",
    { email_config_id: z.number().int().describe("Email config ID.") },
    async ({ email_config_id }) => {
      const res = await fd.get(`/email_configs/${email_config_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view email config", res));
    },
  );
}

// ─── Email Mailboxes ─────────────────────────────
const mailboxId = z.number().int().describe("Mailbox ID.");
const MAILBOX_FIELDS =
  "support_email*, mailbox_type* ('freshdesk_mailbox'|'custom_mailbox'), name, group_id, product_id, default_reply_email, " +
  "custom_mailbox{access_type ('incoming'|'outgoing'|'both'), incoming{mail_server, port, use_ssl, authentication, username, password}, " +
  "outgoing{…same…}} (required for custom_mailbox)";

export function registerMailboxTools(server: McpServer) {
  tool(
    server,
    "list_email_mailboxes",
    "List email mailboxes (support addresses with their routing group/product and IMAP/SMTP settings).",
    {
      support_email: z.string().optional().describe("Exact support email."),
      forward_email: z.string().optional().describe("Exact forward email."),
      group_id: z.number().int().optional().describe("Mailboxes routing to this group."),
      product_id: z.number().int().optional().describe("Mailboxes of this product."),
      active: z.boolean().optional().describe("Only active (true) or inactive (false)."),
      order_by: z
        .enum(["product_id", "group_id"])
        .optional()
        .describe("Sort field (required when order_type is set)."),
      order_type: z.enum(["asc", "desc"]).optional().describe("Sort direction."),
    },
    async (query) => {
      const res = await fd.get("/email/mailboxes", query);
      return text(res.ok ? res.data : errorPayload("Failed to list mailboxes", res));
    },
  );
  tool(
    server,
    "view_email_mailbox",
    "Get one email mailbox.",
    { mailbox_id: mailboxId },
    async ({ mailbox_id }) => {
      const res = await fd.get(`/email/mailboxes/${mailbox_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view mailbox", res));
    },
  );
  tool(
    server,
    "create_email_mailbox",
    `Create an email mailbox. Fields (* required): ${MAILBOX_FIELDS}.`,
    { mailbox: z.record(z.any()).describe("Mailbox payload.") },
    async ({ mailbox }) => {
      const v = validate(MailboxCreate, mailbox);
      if (!v.ok) return v.reply;
      const res = await fd.post("/email/mailboxes", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create mailbox", res));
    },
  );
  tool(
    server,
    "update_email_mailbox",
    `Update an email mailbox; only sent keys change. Fields: ${MAILBOX_FIELDS}.`,
    { mailbox_id: mailboxId, mailbox: z.record(z.any()).describe("Fields to change.") },
    async ({ mailbox_id, mailbox }) => {
      const v = validate(MailboxUpdate, mailbox);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/email/mailboxes/${mailbox_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update mailbox", res));
    },
  );
  tool(
    server,
    "delete_email_mailbox",
    "Delete an email mailbox. Emails to that address stop creating tickets.",
    { mailbox_id: mailboxId },
    async ({ mailbox_id }) => {
      const res = await fd.delete(`/email/mailboxes/${mailbox_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete mailbox", res));
    },
  );

  tool(
    server,
    "view_mailbox_settings",
    "View account-wide email settings (personalized replies, reply-to requester, agent-initiated outbound, forward handling).",
    {},
    async () => {
      const res = await fd.get("/email/settings");
      return text(res.ok ? res.data : errorPayload("Failed to view mailbox settings", res));
    },
  );
  tool(
    server,
    "update_mailbox_settings",
    "Update account-wide email settings. Send only the flags to change.",
    {
      personalized_email_replies: z
        .boolean()
        .optional()
        .describe("Agents' own name as sender name in replies/outbound emails."),
      create_requester_using_reply_to: z
        .boolean()
        .optional()
        .describe("Create requester from Reply-To instead of From."),
      allow_agent_to_initiate_conversation: z
        .boolean()
        .optional()
        .describe("Allow agents to send outbound emails that become tickets."),
      original_sender_as_requester_for_forward: z
        .boolean()
        .optional()
        .describe(
          "When an agent forwards an email to the helpdesk, make the original sender the requester.",
        ),
    },
    async (body) => {
      const res = await fd.put("/email/settings", body);
      return text(res.ok ? res.data : errorPayload("Failed to update mailbox settings", res));
    },
  );

  tool(
    server,
    "view_automatic_bcc_emails",
    "View the addresses automatically BCC'd on all ticket communication.",
    {},
    async () => {
      const res = await fd.get("/notifications/email/bcc");
      return text(res.ok ? res.data : errorPayload("Failed to view automatic BCC", res));
    },
  );
  tool(
    server,
    "update_automatic_bcc_emails",
    "Replace the list of addresses automatically BCC'd on all ticket communication (max 255 characters total). Send [] to clear.",
    { emails: z.array(z.string().email()).describe("Full list of BCC addresses.") },
    async ({ emails }) => {
      const res = await fd.put("/notifications/email/bcc", { emails });
      return text(res.ok ? res.data : errorPayload("Failed to update automatic BCC", res));
    },
  );
}

// ─── Settings / Account ──────────────────────────
export function registerSettingsTools(server: McpServer) {
  tool(
    server,
    "view_helpdesk_settings",
    "View helpdesk settings: primary/supported languages and portal language options.",
    {},
    async () => {
      const res = await fd.get("/settings/helpdesk");
      return text(res.ok ? res.data : errorPayload("Failed to view settings", res));
    },
  );
}

export function registerAccountTools(server: McpServer) {
  tool(
    server,
    "view_account",
    "View account info: plan, data center, time zone, agent counts, account admin contact.",
    {},
    async () => {
      const res = await fd.get("/account");
      return text(res.ok ? res.data : errorPayload("Failed to view account", res));
    },
  );
  tool(
    server,
    "export_account",
    "Account admin only: start a full data export (emailed to the admin when ready). " +
      "resources[].name: tickets | archive_tickets | contacts | companies | groups | forums | canned_responses | surveys | solutions…; " +
      "include examples: tickets → notes, attachments, ticket_states, requester; companies → company_domains.",
    {
      date_range: z
        .object({
          start_date: z.string().describe("ISO-8601, e.g. '2024-01-01T00:00:00Z'."),
          end_date: z.string().describe("ISO-8601."),
        })
        .describe("Only data created within this range."),
      resources: z
        .array(
          z.object({
            name: z.string().describe("Resource name, e.g. 'tickets'."),
            include: z.array(z.string()).optional().describe("Extra sub-resources."),
          }),
        )
        .min(1)
        .describe("Resources to export."),
      output_format: z.enum(["json", "xml"]).optional().default("json").describe("Export format."),
    },
    async (body) => {
      const res = await fd.post("/account/export", body);
      return text(
        res.ok
          ? (res.data ?? { success: true })
          : errorPayload("Failed to start account export", res),
      );
    },
  );
}

// ─── Collaboration threads ───────────────────────
const threadId = z.union([z.string(), z.number()]).describe("Collaboration thread ID.");
const messageId = z.union([z.string(), z.number()]).describe("Thread message ID.");

export function registerThreadTools(server: McpServer) {
  tool(
    server,
    "create_thread",
    "Create a collaboration thread on a ticket (e.g. a forward conversation with third parties). " +
      "Payload: type ('forward'), parent{id: ticket ID, type: 'ticket'}, title?, participants?{emails[], agents[]}, additional_info?{email_config_id}.",
    { thread: z.record(z.any()).describe("Thread payload.") },
    async ({ thread }) => {
      const v = validate(ThreadCreate, thread);
      if (!v.ok) return v.reply;
      const res = await fd.post("/collaboration/threads", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create thread", res));
    },
  );
  tool(
    server,
    "view_thread",
    "Get a collaboration thread.",
    { thread_id: threadId },
    async ({ thread_id }) => {
      const res = await fd.get(`/collaboration/threads/${thread_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view thread", res));
    },
  );
  tool(
    server,
    "update_thread",
    "Update a collaboration thread (title, participants, additional_info).",
    { thread_id: threadId, thread: z.record(z.any()).describe("Fields to change.") },
    async ({ thread_id, thread }) => {
      const v = validate(ThreadUpdate, thread);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/collaboration/threads/${thread_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update thread", res));
    },
  );
  tool(
    server,
    "delete_thread",
    "Delete a collaboration thread.",
    { thread_id: threadId },
    async ({ thread_id }) => {
      const res = await fd.delete(`/collaboration/threads/${thread_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete thread", res));
    },
  );
  tool(
    server,
    "create_thread_message",
    "Post a message to a collaboration thread (sends email for forward threads). " +
      "Payload: body (HTML), participants?{email:{to[], cc[], bcc[]}}, additional_info?{has_quoted_text, email_subject}, attachment_ids[]. " +
      "Use get_thread_message_quote to build quoted text for replies.",
    { thread_id: threadId, message: z.record(z.any()).describe("Message payload.") },
    async ({ thread_id, message }) => {
      const v = validate(ThreadMessageCreate, { ...message, thread_id: String(thread_id) });
      if (!v.ok) return v.reply;
      const res = await fd.post("/collaboration/messages", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create thread message", res));
    },
  );
  tool(
    server,
    "view_thread_message",
    "Get a thread message.",
    { message_id: messageId },
    async ({ message_id }) => {
      const res = await fd.get(`/collaboration/messages/${message_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view thread message", res));
    },
  );
  tool(
    server,
    "get_thread_message_quote",
    "Get the email-style quoted HTML of a thread message, to append when replying.",
    { message_id: messageId },
    async ({ message_id }) => {
      const res = await fd.get(`/collaboration/messages/${message_id}/generate-quote`);
      return text(res.ok ? res.data : errorPayload("Failed to generate quote", res));
    },
  );
  tool(
    server,
    "update_thread_message",
    "Update a thread message's body or metadata.",
    { message_id: messageId, message: z.record(z.any()).describe("Fields to change.") },
    async ({ message_id, message }) => {
      const v = validate(ThreadMessageUpdate, message);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/collaboration/messages/${message_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update thread message", res));
    },
  );
  tool(
    server,
    "delete_thread_message",
    "Delete a thread message.",
    { message_id: messageId },
    async ({ message_id }) => {
      const res = await fd.delete(`/collaboration/messages/${message_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete thread message", res));
    },
  );
}

// ─── Time Entries ────────────────────────────────
const timeEntryId = z.number().int().describe("Time entry ID.");
const TIME_FIELDS =
  "agent_id, billable, note, time_spent ('hh:mm'), executed_at (ISO-8601), start_time, timer_running";

export function registerTimeEntryTools(server: McpServer) {
  tool(
    server,
    "list_time_entries",
    "List time entries across all tickets, filterable by agent, company, billable flag and execution date range.",
    {
      ...pageArgs,
      agent_id: z.number().int().optional().describe("Only entries by this agent."),
      company_id: z.number().int().optional().describe("Only entries on this company's tickets."),
      executed_after: z.string().optional().describe("ISO-8601 UTC timestamp."),
      executed_before: z.string().optional().describe("ISO-8601 UTC timestamp."),
      billable: z.boolean().optional().describe("Only billable (true) or non-billable (false)."),
    },
    async (args) => {
      const res = await fd.get("/time_entries", args);
      return text(res.ok ? res.data : errorPayload("Failed to list time entries", res));
    },
  );
  tool(
    server,
    "create_time_entry",
    `Log time on a ticket. Fields: ${TIME_FIELDS}. Omit time_spent and set timer_running=true to start a live timer.`,
    {
      ticket_id: z.number().int().describe("Ticket ID."),
      time_entry: z.record(z.any()).describe("Time entry payload."),
    },
    async ({ ticket_id, time_entry }) => {
      const v = validate(TimeEntryCreate, time_entry);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/time_entries`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create time entry", res));
    },
  );
  tool(
    server,
    "update_time_entry",
    `Update a time entry; only sent keys change. Fields: ${TIME_FIELDS}.`,
    { time_entry_id: timeEntryId, time_entry: z.record(z.any()).describe("Fields to change.") },
    async ({ time_entry_id, time_entry }) => {
      const v = validate(TimeEntryUpdate, time_entry);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/time_entries/${time_entry_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update time entry", res));
    },
  );
  tool(
    server,
    "toggle_time_entry_timer",
    "Start a stopped timer or stop a running one on a time entry.",
    { time_entry_id: timeEntryId },
    async ({ time_entry_id }) => {
      const res = await fd.put(`/time_entries/${time_entry_id}/toggle_timer`);
      return text(res.ok ? res.data : errorPayload("Failed to toggle timer", res));
    },
  );
  tool(
    server,
    "delete_time_entry",
    "Delete a time entry.",
    { time_entry_id: timeEntryId },
    async ({ time_entry_id }) => {
      const res = await fd.delete(`/time_entries/${time_entry_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete time entry", res));
    },
  );
}
