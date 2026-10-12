import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd } from "../freshdesk.js";
import {
  AutomationRuleCreate,
  AutomationRuleUpdate,
  AutomationTypeIdEnum,
  CommentCreate,
  CommentUpdate,
  CustomObjectRecordCreate,
  CustomObjectRecordUpdate,
  ForumCategoryCreate,
  ForumCategoryUpdate,
  ForumCreate,
  ForumUpdate,
  OutboundEmailCreate,
  SatisfactionRatingCreate,
  TopicCreate,
  TopicUpdate,
} from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

// ─── Discussions / Forums (community) ────────────
const forumCategoryId = z.number().int().describe("Forum category ID.");
const forumId = z.number().int().describe("Forum ID.");
const topicId = z.number().int().describe("Topic ID.");
const commentId = z.number().int().describe("Comment ID.");

export function registerDiscussionTools(server: McpServer) {
  tool(
    server,
    "list_forum_categories",
    "List community forum categories (Discussions; legacy feature, only on accounts that have forums enabled).",
    {},
    async () => {
      const res = await fd.get("/discussions/categories");
      return text(res.ok ? res.data : errorPayload("Failed to list forum categories", res));
    },
  );
  tool(
    server,
    "view_forum_category",
    "Get one forum category.",
    { category_id: forumCategoryId },
    async ({ category_id }) => {
      const res = await fd.get(`/discussions/categories/${category_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view forum category", res));
    },
  );
  tool(
    server,
    "create_forum_category",
    "Create a forum category. Payload: name (required), description.",
    { category: z.record(z.any()).describe("{ name, description? }") },
    async ({ category }) => {
      const v = validate(ForumCategoryCreate, category);
      if (!v.ok) return v.reply;
      const res = await fd.post("/discussions/categories", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create forum category", res));
    },
  );
  tool(
    server,
    "update_forum_category",
    "Update a forum category (name, description).",
    { category_id: forumCategoryId, category: z.record(z.any()).describe("Fields to change.") },
    async ({ category_id, category }) => {
      const v = validate(ForumCategoryUpdate, category);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/discussions/categories/${category_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update forum category", res));
    },
  );
  tool(
    server,
    "delete_forum_category",
    "Delete a forum category with all its forums and topics. Irreversible.",
    { category_id: forumCategoryId },
    async ({ category_id }) => {
      const res = await fd.delete(`/discussions/categories/${category_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete forum category", res));
    },
  );

  tool(
    server,
    "list_forums",
    "List forums in a forum category.",
    { category_id: forumCategoryId },
    async ({ category_id }) => {
      const res = await fd.get(`/discussions/categories/${category_id}/forums`);
      return text(res.ok ? res.data : errorPayload("Failed to list forums", res));
    },
  );
  tool(server, "view_forum", "Get one forum.", { forum_id: forumId }, async ({ forum_id }) => {
    const res = await fd.get(`/discussions/forums/${forum_id}`);
    return text(res.ok ? res.data : errorPayload("Failed to view forum", res));
  });
  tool(
    server,
    "create_forum",
    "Create a forum in a category. Payload: name, forum_type (1=how-to 2=ideas 3=problems 4=announcements) required; " +
      "description, forum_visibility (1=all 2=logged-in 3=agents 4=selected companies), company_ids[].",
    { category_id: forumCategoryId, forum: z.record(z.any()).describe("Forum payload.") },
    async ({ category_id, forum }) => {
      const v = validate(ForumCreate, forum);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/discussions/categories/${category_id}/forums`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create forum", res));
    },
  );
  tool(
    server,
    "update_forum",
    "Update a forum (name, description, forum_type, forum_visibility…).",
    { forum_id: forumId, forum: z.record(z.any()).describe("Fields to change.") },
    async ({ forum_id, forum }) => {
      const v = validate(ForumUpdate, forum);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/discussions/forums/${forum_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update forum", res));
    },
  );
  tool(
    server,
    "delete_forum",
    "Delete a forum with all its topics. Irreversible.",
    { forum_id: forumId },
    async ({ forum_id }) => {
      const res = await fd.delete(`/discussions/forums/${forum_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete forum", res));
    },
  );

  tool(
    server,
    "list_topics",
    "List topics (threads) in a forum.",
    { forum_id: forumId },
    async ({ forum_id }) => {
      const res = await fd.get(`/discussions/forums/${forum_id}/topics`);
      return text(res.ok ? res.data : errorPayload("Failed to list topics", res));
    },
  );
  tool(
    server,
    "view_topic",
    "Get one forum topic.",
    { topic_id: topicId },
    async ({ topic_id }) => {
      const res = await fd.get(`/discussions/topics/${topic_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view topic", res));
    },
  );
  tool(
    server,
    "create_topic",
    "Create a topic in a forum. Payload: title, message_html (required), sticky, locked, stamp_type.",
    { forum_id: forumId, topic: z.record(z.any()).describe("Topic payload.") },
    async ({ forum_id, topic }) => {
      const v = validate(TopicCreate, topic);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/discussions/forums/${forum_id}/topics`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create topic", res));
    },
  );
  tool(
    server,
    "update_topic",
    "Update a forum topic (title, message_html, sticky, locked, stamp_type).",
    { topic_id: topicId, topic: z.record(z.any()).describe("Fields to change.") },
    async ({ topic_id, topic }) => {
      const v = validate(TopicUpdate, topic);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/discussions/topics/${topic_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update topic", res));
    },
  );
  tool(
    server,
    "delete_topic",
    "Delete a forum topic and its comments.",
    { topic_id: topicId },
    async ({ topic_id }) => {
      const res = await fd.delete(`/discussions/topics/${topic_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete topic", res));
    },
  );

  tool(
    server,
    "list_topic_comments",
    "List comments on a forum topic.",
    { topic_id: topicId },
    async ({ topic_id }) => {
      const res = await fd.get(`/discussions/topics/${topic_id}/comments`);
      return text(res.ok ? res.data : errorPayload("Failed to list comments", res));
    },
  );
  tool(
    server,
    "create_topic_comment",
    "Comment on a forum topic. Payload: body_html (required), answer (mark as answer).",
    { topic_id: topicId, comment: z.record(z.any()).describe("Comment payload.") },
    async ({ topic_id, comment }) => {
      const v = validate(CommentCreate, comment);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/discussions/topics/${topic_id}/comments`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create comment", res));
    },
  );
  tool(
    server,
    "update_topic_comment",
    "Update a forum comment (body_html, answer).",
    { comment_id: commentId, comment: z.record(z.any()).describe("Fields to change.") },
    async ({ comment_id, comment }) => {
      const v = validate(CommentUpdate, comment);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/discussions/comments/${comment_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update comment", res));
    },
  );
  tool(
    server,
    "delete_topic_comment",
    "Delete a forum comment.",
    { comment_id: commentId },
    async ({ comment_id }) => {
      const res = await fd.delete(`/discussions/comments/${comment_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete comment", res));
    },
  );
}

// ─── Surveys / Satisfaction ──────────────────────
const tokenPaging = {
  per_page: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Page size (default 30, max 100)."),
  next_token: z.string().optional().describe("Token from paging.next of the previous response."),
  prev_token: z
    .string()
    .optional()
    .describe("Token from paging.previous of the previous response."),
};

export function registerSurveyTools(server: McpServer) {
  tool(
    server,
    "list_csat_surveys",
    "List customer-satisfaction surveys (new CSAT engine) with their questions, scales, choices and logic. " +
      "Use the survey id and question ids with create_survey_response / list_survey_responses.",
    {
      state: z
        .enum(["ACTIVE", "DRAFT", "PAUSE", "IN_PROGRESS"])
        .optional()
        .describe("Only surveys in this state."),
      ...tokenPaging,
    },
    async (args) => {
      const res = await fd.get("/customer-satisfaction/surveys", args);
      return text(res.ok ? res.data : errorPayload("Failed to list CSAT surveys", res));
    },
  );
  tool(
    server,
    "list_survey_responses",
    "List responses to a CSAT survey (new engine), filterable by date and completion status.",
    {
      survey_id: z.string().describe("Survey ID (UUID) from list_csat_surveys."),
      created_since: z
        .string()
        .optional()
        .describe("ISO-8601; only responses created on/after this."),
      status: z
        .enum(["COMPLETE", "PARTIAL_COMPLETE", "PARTIAL"])
        .optional()
        .describe("Response status."),
      ...tokenPaging,
    },
    async ({ survey_id, ...query }) => {
      const res = await fd.get(`/customer-satisfaction/surveys/${survey_id}/responses`, query);
      return text(res.ok ? res.data : errorPayload("Failed to list survey responses", res));
    },
  );
  tool(
    server,
    "create_survey_response",
    "Submit CSAT feedback for a resolved ticket (new engine). Include at least the required rating question. " +
      "Answer value: integer for rating scales, string for text, option value string for single choice, array of option values for multi choice.",
    {
      survey_id: z.string().describe("Survey ID (UUID)."),
      ticket_id: z.number().int().describe("Ticket being rated."),
      answers: z
        .array(
          z.object({
            question_id: z.string().describe("Question ID, e.g. 'Q_1'."),
            value: z.union([z.number(), z.string(), z.array(z.string())]).describe("Answer value."),
          }),
        )
        .min(1)
        .describe("One entry per question; no duplicates."),
    },
    async ({ survey_id, ticket_id, answers }) => {
      const res = await fd.post(`/customer-satisfaction/surveys/${survey_id}/responses`, {
        ticket_id,
        answers,
      });
      return text(res.ok ? res.data : errorPayload("Failed to create survey response", res));
    },
  );

  tool(
    server,
    "list_surveys",
    "List classic satisfaction surveys (legacy engine) and their questions.",
    {},
    async () => {
      const res = await fd.get("/surveys");
      return text(res.ok ? res.data : errorPayload("Failed to list surveys", res));
    },
  );
  tool(
    server,
    "view_survey",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Get one classic satisfaction survey.",
    { survey_id: z.number().int().describe("Survey ID.") },
    async ({ survey_id }) => {
      const res = await fd.get(`/surveys/${survey_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view survey", res));
    },
  );
  tool(
    server,
    "list_satisfaction_ratings",
    "List classic satisfaction ratings across tickets. Rating values: new surveys 103..-103 (Extremely happy..Extremely unhappy, 100=neutral); " +
      "classic 1=happy 2=neutral 3=unhappy.",
    {
      ...pageArgs,
      created_since: z.string().optional().describe("ISO-8601 UTC timestamp."),
      user_id: z.number().int().optional().describe("Only ratings by this contact."),
    },
    async (args) => {
      const res = await fd.get("/surveys/satisfaction_ratings", args);
      return text(res.ok ? res.data : errorPayload("Failed to list satisfaction ratings", res));
    },
  );
  tool(
    server,
    "create_satisfaction_rating",
    "Record a classic satisfaction rating on a ticket. Payload: ratings{default_question: 103..-103 (or 1..3 for classic), <question_id>: value}, feedback?.",
    {
      ticket_id: z.number().int().describe("Ticket ID."),
      rating: z.record(z.any()).describe("{ ratings: {...}, feedback? }"),
    },
    async ({ ticket_id, rating }) => {
      const v = validate(SatisfactionRatingCreate, rating);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/tickets/${ticket_id}/satisfaction_ratings`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create satisfaction rating", res));
    },
  );
}

// ─── Automations ─────────────────────────────────
const automationType = AutomationTypeIdEnum.describe(
  "Rule type: 1=on ticket creation, 3=hourly (time) triggers, 4=on ticket updates.",
);
const ruleId = z.number().int().describe("Automation rule ID.");
const RULE_FIELDS =
  "name (required), position, active, performer{type, members[]} (type 4 only), events[{field_name, from, to}] (type 4 only), " +
  "conditions[{name, match_type 'all'|'any', properties[{resource_type, field_name, operator, value}]}], operator ('condition_set_1 or condition_set_2'), " +
  "actions[{field_name, value}]";

export function registerAutomationTools(server: McpServer) {
  tool(
    server,
    "list_automation_rules",
    "List automation rules of one type, in execution order.",
    { automation_type_id: automationType },
    async ({ automation_type_id }) => {
      const res = await fd.get(`/automations/${automation_type_id}/rules`);
      return text(res.ok ? res.data : errorPayload("Failed to list automation rules", res));
    },
  );
  tool(
    server,
    "view_automation_rule",
    "Get one automation rule with its events, conditions and actions.",
    { automation_type_id: automationType, rule_id: ruleId },
    async ({ automation_type_id, rule_id }) => {
      const res = await fd.get(`/automations/${automation_type_id}/rules/${rule_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view automation rule", res));
    },
  );
  tool(
    server,
    "create_automation_rule",
    `Create an automation rule. Tip: copy the shape of an existing rule from view_automation_rule. Fields: ${RULE_FIELDS}.`,
    { automation_type_id: automationType, rule: z.record(z.any()).describe("Rule payload.") },
    async ({ automation_type_id, rule }) => {
      const v = validate(AutomationRuleCreate, rule);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/automations/${automation_type_id}/rules`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create automation rule", res));
    },
  );
  tool(
    server,
    "update_automation_rule",
    `Update an automation rule; only sent keys change (conditions/actions replace the full list). Fields: ${RULE_FIELDS}.`,
    {
      automation_type_id: automationType,
      rule_id: ruleId,
      rule: z.record(z.any()).describe("Fields to change."),
    },
    async ({ automation_type_id, rule_id, rule }) => {
      const v = validate(AutomationRuleUpdate, rule);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/automations/${automation_type_id}/rules/${rule_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update automation rule", res));
    },
  );
  tool(
    server,
    "delete_automation_rule",
    "Delete an automation rule.",
    { automation_type_id: automationType, rule_id: ruleId },
    async ({ automation_type_id, rule_id }) => {
      const res = await fd.delete(`/automations/${automation_type_id}/rules/${rule_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete automation rule", res));
    },
  );
}

// ─── Scenario Automations ────────────────────────
export function registerScenarioTools(server: McpServer) {
  tool(
    server,
    "list_scenario_automations",
    "List scenario automations (one-click macros that apply several ticket actions at once).",
    {},
    async () => {
      const res = await fd.get("/scenario_automations");
      return text(res.ok ? res.data : errorPayload("Failed to list scenarios", res));
    },
  );
  tool(
    server,
    "view_scenario_automation",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Get one scenario automation and its actions.",
    { scenario_id: z.number().int().describe("Scenario ID.") },
    async ({ scenario_id }) => {
      const res = await fd.get(`/scenario_automations/${scenario_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view scenario", res));
    },
  );
  tool(
    server,
    "execute_scenario",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Run a scenario automation on a ticket (applies all its actions).",
    {
      ticket_id: z.number().int().describe("Ticket ID."),
      scenario_id: z.number().int().describe("Scenario ID."),
    },
    async ({ ticket_id, scenario_id }) => {
      const res = await fd.put(`/tickets/${ticket_id}/execute_scenario`, { scenario_id });
      return text(res.ok ? res.data : errorPayload("Failed to execute scenario", res));
    },
  );
}

// ─── Custom Objects ──────────────────────────────
const schemaId = z.string().describe("Custom object schema ID.");
const recordId = z.string().describe("Record display_id, e.g. 'BKG-1'.");

export function registerCustomObjectTools(server: McpServer) {
  tool(
    server,
    "list_custom_object_schemas",
    "List custom objects (schemas) defined in the account.",
    {},
    async () => {
      const res = await fd.get("/custom_objects/schemas");
      return text(res.ok ? res.data : errorPayload("Failed to list schemas", res));
    },
  );
  tool(
    server,
    "view_custom_object_schema",
    "Get a custom object schema: field names, types, required flags and lookup targets. Call before creating/filtering records.",
    { schema_id: schemaId },
    async ({ schema_id }) => {
      const res = await fd.get(`/custom_objects/schemas/${schema_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view schema", res));
    },
  );
  tool(
    server,
    "list_custom_object_records",
    "List or filter records of a custom object. Pagination is cursor-based: pass next_token from the previous response's _links.next. " +
      "Filters are AND-ed query conditions: { field_name: value } for equality, or operators via key suffix like { 'age[gt]': 30, 'created_time[gte]': '2024-01-01T00:00:00.000Z' } " +
      "(gt, lt, gte, lte; != and OR not supported). Lookup filters use the target's ID (ticket display_id, org_contact_id, org_company_id).",
    {
      schema_id: schemaId,
      page_size: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Records per page (default 20, max 100)."),
      next_token: z.string().optional().describe("Cursor from _links.next."),
      filters: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe("Field filters."),
    },
    async ({ schema_id, page_size, next_token, filters }) => {
      const res = await fd.get(`/custom_objects/schemas/${schema_id}/records`, {
        page_size,
        next_token,
        ...filters,
      });
      return text(res.ok ? res.data : errorPayload("Failed to list records", res));
    },
  );
  tool(
    server,
    "count_custom_object_records",
    "Count records of a custom object.",
    { schema_id: schemaId },
    async ({ schema_id }) => {
      const res = await fd.get(`/custom_objects/schemas/${schema_id}/records/count`);
      return text(res.ok ? res.data : errorPayload("Failed to count records", res));
    },
  );
  tool(
    server,
    "view_custom_object_record",
    "Get one custom object record.",
    { schema_id: schemaId, record_id: recordId },
    async ({ schema_id, record_id }) => {
      const res = await fd.get(`/custom_objects/schemas/${schema_id}/records/${record_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view record", res));
    },
  );
  tool(
    server,
    "create_custom_object_record",
    "Create a custom object record. Payload: { data: { <field_name>: value, … } } using names from view_custom_object_schema. " +
      "Lookup fields take the target's ID (ticket display_id, org_contact_id, org_company_id, or record id).",
    { schema_id: schemaId, record: z.record(z.any()).describe("{ data: {...} }") },
    async ({ schema_id, record }) => {
      const v = validate(CustomObjectRecordCreate, record);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/custom_objects/schemas/${schema_id}/records`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create record", res));
    },
  );
  tool(
    server,
    "update_custom_object_record",
    "Update a custom object record. Send the full record as returned by view_custom_object_record (including version) with changed data values.",
    {
      schema_id: schemaId,
      record_id: recordId,
      record: z.record(z.any()).describe("{ data: {...}, version? }"),
    },
    async ({ schema_id, record_id, record }) => {
      const v = validate(CustomObjectRecordUpdate, record);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/custom_objects/schemas/${schema_id}/records/${record_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update record", res));
    },
  );
  tool(
    server,
    "delete_custom_object_record",
    "Delete a custom object record.",
    { schema_id: schemaId, record_id: recordId },
    async ({ schema_id, record_id }) => {
      const res = await fd.delete(`/custom_objects/schemas/${schema_id}/records/${record_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete record", res));
    },
  );
}

// ─── FSM (Field Service Management) ──────────────
// Service tasks are regular tickets with type 'Service Task' (see "Service Task" in the API docs).
const taskId = z.number().int().describe("Service task (ticket) ID.");
const FSM_FIELDS =
  "subject, description, status, priority, requester_id|email, responder_id (field technician agent), group_id (service group), " +
  "custom_fields{cf_fsm_contact_name*, cf_fsm_phone_number*, cf_fsm_service_location*, cf_fsm_appointment_start_time, cf_fsm_appointment_end_time (UTC ISO-8601)} " +
  "(* required on create)";

export function registerFsmTools(server: McpServer) {
  tool(
    server,
    "list_service_tasks",
    "List Field Service Management service tasks (tickets of type 'Service Task'; requires the FSM add-on). " +
      'Optional extra filter in search_tickets syntax, e.g. "status:2 AND agent_id:123". 30 per page, max 10 pages.',
    {
      filter: z.string().optional().describe("Extra query AND-ed with type:'Service Task'."),
      page: z.number().int().min(1).max(10).optional().describe("Result page 1-10."),
    },
    async ({ filter, page }) => {
      const q = filter ? `type:'Service Task' AND (${filter})` : "type:'Service Task'";
      const res = await fd.get("/search/tickets", { query: `"${q}"`, page });
      return text(res.ok ? res.data : errorPayload("Failed to list service tasks", res));
    },
  );
  tool(
    server,
    "view_service_task",
    "Get one FSM service task (a ticket) including its cf_fsm_* custom fields.",
    { task_id: taskId },
    async ({ task_id }) => {
      const res = await fd.get(`/tickets/${task_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view service task", res));
    },
  );
  tool(
    server,
    "create_service_task",
    `Create an FSM service task, optionally under a parent ticket (max 10 per parent). type is forced to 'Service Task'. Fields: ${FSM_FIELDS}.`,
    {
      parent_id: z.number().int().optional().describe("Parent ticket ID to attach the task to."),
      task: z.record(z.any()).describe("Ticket payload for the task."),
    },
    async ({ parent_id, task }) => {
      const res = await fd.post("/tickets", {
        ...task,
        type: "Service Task",
        ...(parent_id ? { parent_id } : {}),
      });
      return text(res.ok ? res.data : errorPayload("Failed to create service task", res));
    },
  );
  tool(
    server,
    "update_service_task",
    `Update an FSM service task (e.g. reschedule, reassign technician, change status); only sent keys change. Fields: ${FSM_FIELDS}.`,
    { task_id: taskId, task: z.record(z.any()).describe("Fields to change.") },
    async ({ task_id, task }) => {
      const res = await fd.put(`/tickets/${task_id}`, task);
      return text(res.ok ? res.data : errorPayload("Failed to update service task", res));
    },
  );
  tool(
    server,
    "delete_service_task",
    "Delete (trash) an FSM service task.",
    { task_id: taskId },
    async ({ task_id }) => {
      const res = await fd.delete(`/tickets/${task_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete service task", res));
    },
  );
}

// ─── Outbound (email + WhatsApp) ─────────────────
export function registerOutboundTools(server: McpServer) {
  tool(
    server,
    "create_outbound_email",
    "Start a new email conversation with a customer (creates an outbound ticket, Closed + assigned to you by default so SLA doesn't run). " +
      "Required: email, subject, email_config_id (see list_email_configs). Optional: name, description (HTML), status, priority, type, group_id, " +
      "responder_id, cc_emails[], tags[], custom_fields{}, due_by, fr_due_by. Subject/description can't be edited later.",
    { email: z.record(z.any()).describe("Outbound email payload.") },
    async ({ email }) => {
      const v = validate(OutboundEmailCreate, email);
      if (!v.ok) return v.reply;
      const res = await fd.post("/tickets/outbound_email", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create outbound email", res));
    },
  );

  tool(
    server,
    "send_whatsapp_message",
    "Send a proactive WhatsApp template message (queued, sent asynchronously). The template must be approved by Meta in your WABA. " +
      "Returns a message_id — check delivery with view_outbound_message.",
    {
      from: z
        .string()
        .describe("WhatsApp Business number configured in Freshdesk, e.g. '+14155550100'."),
      to: z.string().describe("Recipient phone number in E.164 format."),
      template_name: z.string().describe("Approved template name."),
      language_code: z.string().describe("Template language code, e.g. 'en'."),
      components: z
        .array(z.record(z.any()))
        .optional()
        .describe(
          "Template components: [{ type: 'header'|'body'|'button', parameters: [{ type: 'text', text: '…' }], sub_type?, index? }].",
        ),
      external_reference_id: z
        .string()
        .optional()
        .describe("Your own ID, echoed back in webhooks."),
      extra: z
        .record(z.any())
        .optional()
        .describe(
          "Additional top-level fields, e.g. note_policy{on_reply{mode}}, ticket_properties{tags[], custom_fields{}}.",
        ),
    },
    async ({
      from,
      to,
      template_name,
      language_code,
      components,
      external_reference_id,
      extra,
    }) => {
      const res = await fd.post("/channels/outbound-messages", {
        ...extra,
        from: { channel_identifier: from },
        to: { recipient_identifier: to },
        channel_type: "WHATSAPP",
        message: {
          type: "TEMPLATE",
          template: { name: template_name, language: { code: language_code }, components },
        },
        external_reference_id,
      });
      return text(res.ok ? res.data : errorPayload("Failed to send WhatsApp message", res));
    },
  );

  tool(
    server,
    "view_outbound_message",
    "Get the status of a proactive outbound message (e.g. QUEUED, SENT, DELIVERED, READ, FAILED with error_code/error_message).",
    { message_id: z.string().describe("message_id returned by send_whatsapp_message.") },
    async ({ message_id }) => {
      const res = await fd.get(`/channels/outbound-messages/${message_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view outbound message", res));
    },
  );
}

// ─── Jobs ────────────────────────────────────────
export function registerJobTools(server: McpServer) {
  tool(
    server,
    "view_job_status",
    "Check an async bulk job (bulk_update/bulk_delete/bulk_create tickets, bulk agents, bulk canned responses): status and per-item results.",
    { job_id: z.string().describe("job_id returned by the bulk call.") },
    async ({ job_id }) => {
      const res = await fd.get(`/jobs/${job_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view job status", res));
    },
  );
}

// ─── Contact activities (Omnichannel timeline) ───
export function registerOmnichannelTools(server: McpServer) {
  tool(
    server,
    "publish_contact_activity",
    "Publish an external-app event (e.g. 'Placed order #123') to a contact's timeline. " +
      "Payload activity: name (required, shown in timeline), actor{type, email|id…} (required, who did it), source{name, id} (required, which app), " +
      "timestamp?, description?, link?, object?{…}, context?{…}.",
    { activity: z.record(z.any()).describe("Activity object.") },
    async ({ activity }) => {
      const res = await fd.post("/contact-activities", { activity });
      return text(
        res.ok ? (res.data ?? { success: true }) : errorPayload("Failed to publish activity", res),
      );
    },
  );
}
