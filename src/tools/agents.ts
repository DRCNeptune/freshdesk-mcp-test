import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd, requestFirstOf } from "../freshdesk.js";
import { AgentCreate, AgentUpdate, GroupCreate, GroupUpdate } from "../schemas/index.js";
import { pageArgs, text, tool, validate } from "../util.js";

const agentId = z.number().int().describe("Agent ID (not the contact ID).");
const groupId = z.number().int().describe("Group ID.");
const AGENT_FIELDS =
  "email (required on create), ticket_scope (1=global 2=group 3=restricted; required on create), occasional, signature, " +
  "group_ids[], contribution_group_ids[], role_ids[], skill_ids[], agent_type, language, time_zone, focus_mode";
const GROUP_FIELDS =
  "name (required on create), description, agent_ids[], auto_ticket_assign (0|1), escalate_to (agent ID), " +
  "unassigned_for ('30m'|'1h'|'2h'|'4h'|'8h'|'12h'|'1d'|'2d'|'3d')";
const ADMIN_GROUP_FIELDS =
  "name, description, type ('support_agent_group'|'field_agent_group'), agent_ids[], escalate_to, unassigned_for, " +
  "business_calendar_id, allow_agents_to_change_availability, automatic_agent_assignment{enabled, type, settings[]}";

export function registerAgentTools(server: McpServer) {
  tool(
    server,
    "get_agents",
    "List agents (support staff) with their contact info, ticket_scope, group/role IDs and availability flag.",
    {
      ...pageArgs,
      email: z.string().email().optional().describe("Exact email filter."),
      mobile: z.string().optional().describe("Exact mobile filter."),
      phone: z.string().optional().describe("Exact phone filter."),
      state: z.enum(["fulltime", "occasional"]).optional().describe("Agent type filter."),
    },
    async (args) => {
      const res = await fd.get("/agents", args);
      return text(res.ok ? res.data : errorPayload("Failed to list agents", res));
    },
  );

  tool(
    server,
    "view_agent",
    "Get one agent by ID.",
    { agent_id: agentId },
    async ({ agent_id }) => {
      const res = await fd.get(`/agents/${agent_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to fetch agent", res));
    },
  );

  tool(
    server,
    "view_current_agent",
    "Get the agent who owns the API key (useful as 'me', e.g. for responder_id).",
    {},
    async () => {
      const res = await fd.get("/agents/me");
      return text(res.ok ? res.data : errorPayload("Failed to view current agent", res));
    },
  );

  tool(
    server,
    "search_agents",
    "Autocomplete agents by name or email prefix. Returns id, name, email — use it to resolve a person to an agent ID.",
    { query: z.string().describe("Name/email prefix.") },
    async ({ query }) => {
      const res = await fd.get("/agents/autocomplete", { term: query });
      return text(res.ok ? res.data : errorPayload("Failed to search agents", res));
    },
  );

  tool(
    server,
    "create_agent",
    `Create (invite) an agent. Fields: ${AGENT_FIELDS}.`,
    { agent: z.record(z.any()).describe("Agent payload.") },
    async ({ agent }) => {
      const v = validate(AgentCreate, agent);
      if (!v.ok) return v.reply;
      const res = await fd.post("/agents", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create agent", res));
    },
  );

  tool(
    server,
    "bulk_create_agents",
    "Create many agents in one async job. Each item: create_agent fields plus name, phone, mobile, job_title. Returns a job_id — poll view_job_status.",
    { agents: z.array(z.record(z.any())).min(1).describe("Agent payloads.") },
    async ({ agents }) => {
      const validated: any[] = [];
      for (let i = 0; i < agents.length; i++) {
        const v = validate(AgentCreate, agents[i]);
        if (!v.ok)
          return text({
            error: `Agent at index ${i} failed validation`,
            issues: (v.reply.content[0] as any).text,
          });
        validated.push(v.data);
      }
      const res = await fd.post("/agents/bulk", { agents: validated });
      return text(res.ok ? res.data : errorPayload("Failed to bulk create agents", res));
    },
  );

  tool(
    server,
    "update_agent",
    `Update an agent; only sent keys change (group_ids/role_ids/skill_ids replace the full list). Fields: ${AGENT_FIELDS}.`,
    { agent_id: agentId, agent: z.record(z.any()).describe("Fields to change.") },
    async ({ agent_id, agent }) => {
      const v = validate(AgentUpdate, agent);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/agents/${agent_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update agent", res));
    },
  );

  tool(
    server,
    "delete_agent",
    "Delete an agent: they are downgraded to a contact (their tickets are kept).",
    { agent_id: agentId },
    async ({ agent_id }) => {
      const res = await fd.delete(`/agents/${agent_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete agent", res));
    },
  );

  // ─── Availability (Omni routing) ──────────────────
  tool(
    server,
    "list_agent_availabilities",
    "List all agents with per-channel availability: available, logged_in, assignment_limit, current_assignment_load, status, round_robin_enabled.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/agents", { page, per_page, only: "availability" });
      return text(res.ok ? res.data : errorPayload("Failed to list availabilities", res));
    },
  );

  tool(
    server,
    "view_agent_availability",
    "View one agent's per-channel availability and assignment load.",
    { agent_id: agentId },
    async ({ agent_id }) => {
      const res = await fd.get(`/agents/${agent_id}/availability`);
      return text(res.ok ? res.data : errorPayload("Failed to view availability", res));
    },
  );

  tool(
    server,
    "update_agent_availability",
    "Update an agent's load settings: per-channel assignment_limit and/or availability_control.",
    {
      agent_id: agentId,
      channel_availability: z
        .array(
          z.object({
            channel: z
              .string()
              .describe("Channel/queue name, e.g. 'Email queue', 'Messaging queue', 'freshdesk'."),
            assignment_limit: z
              .number()
              .int()
              .min(0)
              .describe("Max tickets assigned concurrently."),
          }),
        )
        .optional()
        .describe("Per-channel limits to set."),
      availability_control: z
        .string()
        .optional()
        .describe("Who controls availability, e.g. 'agent_controlled'."),
    },
    async ({ agent_id, ...body }) => {
      const res = await requestFirstOf(["PATCH", "PUT"], `/agents/${agent_id}/availability`, body);
      return text(res.ok ? res.data : errorPayload("Failed to update availability", res));
    },
  );
}

export function registerGroupTools(server: McpServer) {
  tool(
    server,
    "list_groups",
    "List agent groups (teams tickets can be assigned to).",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/groups", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list groups", res));
    },
  );

  tool(
    server,
    "view_group",
    "Get one group by ID.",
    { group_id: groupId },
    async ({ group_id }) => {
      const res = await fd.get(`/groups/${group_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view group", res));
    },
  );

  tool(
    server,
    "create_group",
    `Create a group. Fields: ${GROUP_FIELDS}.`,
    { group: z.record(z.any()).describe("Group payload.") },
    async ({ group }) => {
      const v = validate(GroupCreate, group);
      if (!v.ok) return v.reply;
      const res = await fd.post("/groups", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create group", res));
    },
  );

  tool(
    server,
    "update_group",
    `Update a group; only sent keys change (agent_ids replaces the member list). Fields: ${GROUP_FIELDS}.`,
    { group_id: groupId, group: z.record(z.any()).describe("Fields to change.") },
    async ({ group_id, group }) => {
      const v = validate(GroupUpdate, group);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/groups/${group_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update group", res));
    },
  );

  tool(
    server,
    "delete_group",
    "Delete a group. Tickets assigned to it become unassigned from the group.",
    { group_id: groupId },
    async ({ group_id }) => {
      const res = await fd.delete(`/groups/${group_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete group", res));
    },
  );

  // Admin groups API: newer endpoint with omnichannel routing settings.
  tool(
    server,
    "list_admin_groups",
    "List groups via the admin API (includes routing/omnichannel settings). Prefer this on Omni accounts.",
    pageArgs,
    async ({ page, per_page }) => {
      const res = await fd.get("/admin/groups", { page, per_page });
      return text(res.ok ? res.data : errorPayload("Failed to list admin groups", res));
    },
  );

  tool(
    server,
    "view_admin_group",
    "Get one group via the admin API (with routing settings).",
    { group_id: groupId },
    async ({ group_id }) => {
      const res = await fd.get(`/admin/groups/${group_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view admin group", res));
    },
  );

  tool(
    server,
    "create_admin_group",
    `Create a group via the admin API. Fields: ${ADMIN_GROUP_FIELDS}.`,
    { group: z.record(z.any()).describe("Group payload.") },
    async ({ group }) => {
      const v = validate(GroupCreate, group);
      if (!v.ok) return v.reply;
      const res = await fd.post("/admin/groups", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create admin group", res));
    },
  );

  tool(
    server,
    "update_admin_group",
    `Update a group via the admin API; only sent keys change. Fields: ${ADMIN_GROUP_FIELDS}.`,
    { group_id: groupId, group: z.record(z.any()).describe("Fields to change.") },
    async ({ group_id, group }) => {
      const v = validate(GroupUpdate, group);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/admin/groups/${group_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update admin group", res));
    },
  );

  tool(
    server,
    "delete_admin_group",
    "Delete a group via the admin API.",
    { group_id: groupId },
    async ({ group_id }) => {
      const res = await fd.delete(`/admin/groups/${group_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete admin group", res));
    },
  );

  tool(
    server,
    "list_group_agents",
    "List the agents who are members of a group.",
    { group_id: groupId },
    async ({ group_id }) => {
      const res = await fd.get(`/admin/groups/${group_id}/agents`);
      return text(res.ok ? res.data : errorPayload("Failed to list group agents", res));
    },
  );

  tool(
    server,
    "update_group_agents",
    "Add and/or remove agents in a group without resending the full member list.",
    {
      group_id: groupId,
      add: z.array(z.number().int()).optional().default([]).describe("Agent IDs to add."),
      remove: z.array(z.number().int()).optional().default([]).describe("Agent IDs to remove."),
    },
    async ({ group_id, add, remove }) => {
      if (add.length + remove.length === 0) return text({ error: "Provide add and/or remove" });
      const agents = [...add.map((id) => ({ id })), ...remove.map((id) => ({ id, deleted: true }))];
      const res = await requestFirstOf(["PATCH", "PUT"], `/admin/groups/${group_id}/agents`, {
        agents,
      });
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to update group agents", res));
    },
  );
}
