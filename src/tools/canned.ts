import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd } from "../freshdesk.js";
import {
  CannedResponseCreate,
  CannedResponseFolderCreate,
  CannedResponseUpdate,
} from "../schemas/index.js";
import { text, tool, validate } from "../util.js";

const folderId = z.number().int().describe("Canned response folder ID.");
const cannedId = z.number().int().describe("Canned response ID.");
const CANNED_FIELDS =
  "title, content_html, folder_id, visibility (0=all agents 1=personal 2=selected groups), group_ids[] (required when visibility=2)";

export function registerCannedTools(server: McpServer) {
  tool(
    server,
    "list_canned_response_folders",
    "List canned response (saved reply template) folders with response counts. Start here to browse templates.",
    {},
    async () => {
      const res = await fd.get("/canned_response_folders");
      return text(res.ok ? res.data : errorPayload("Failed to list folders", res));
    },
  );

  tool(
    server,
    "view_canned_response_folder",
    "View a folder and the id/title of each canned response in it (no content).",
    { folder_id: folderId },
    async ({ folder_id }) => {
      const res = await fd.get(`/canned_response_folders/${folder_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view folder", res));
    },
  );

  tool(
    server,
    "list_canned_responses",
    "List canned responses in a folder with full content (content_html, attachments).",
    { folder_id: folderId },
    async ({ folder_id }) => {
      const res = await fd.get(`/canned_response_folders/${folder_id}/responses`);
      return text(res.ok ? res.data : errorPayload("Failed to list canned responses", res));
    },
  );

  tool(
    server,
    "view_canned_response",
    "Get one canned response with its HTML content. Placeholders like {{ticket.requester.name}} are returned unrendered.",
    { canned_response_id: cannedId },
    async ({ canned_response_id }) => {
      const res = await fd.get(`/canned_responses/${canned_response_id}`);
      return text(res.ok ? res.data : errorPayload("Failed to view canned response", res));
    },
  );

  tool(
    server,
    "create_canned_response",
    `Create a canned response. Required: ${CANNED_FIELDS}. File attachments (multipart) are not supported.`,
    { canned_response: z.record(z.any()).describe("Canned response payload.") },
    async ({ canned_response }) => {
      const v = validate(CannedResponseCreate, canned_response);
      if (!v.ok) return v.reply;
      const res = await fd.post("/canned_responses", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create canned response", res));
    },
  );

  tool(
    server,
    "bulk_create_canned_responses",
    `Create many canned responses in one async job. Each item: ${CANNED_FIELDS}. Returns a job_id — poll view_job_status.`,
    { canned_responses: z.array(z.record(z.any())).min(1).describe("Canned response payloads.") },
    async ({ canned_responses }) => {
      const validated: any[] = [];
      for (let i = 0; i < canned_responses.length; i++) {
        const v = validate(CannedResponseCreate, canned_responses[i]);
        if (!v.ok)
          return text({
            error: `Canned response at index ${i} failed validation`,
            issues: (v.reply.content[0] as any).text,
          });
        validated.push(v.data);
      }
      const res = await fd.post("/canned_responses/bulk", { canned_responses: validated });
      return text(res.ok ? res.data : errorPayload("Failed to bulk create canned responses", res));
    },
  );

  tool(
    server,
    "update_canned_response",
    `Update a canned response; only sent keys change. Fields: ${CANNED_FIELDS}.`,
    {
      canned_response_id: cannedId,
      canned_response: z.record(z.any()).describe("Fields to change."),
    },
    async ({ canned_response_id, canned_response }) => {
      const v = validate(CannedResponseUpdate, canned_response);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/canned_responses/${canned_response_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update canned response", res));
    },
  );

  tool(
    server,
    "delete_canned_response",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Delete a canned response.",
    { canned_response_id: cannedId },
    async ({ canned_response_id }) => {
      const res = await fd.delete(`/canned_responses/${canned_response_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete canned response", res));
    },
  );

  tool(
    server,
    "create_canned_response_folder",
    "Create a canned response folder. Payload: { name }.",
    { folder: z.record(z.any()).describe("{ name }") },
    async ({ folder }) => {
      const v = validate(CannedResponseFolderCreate, folder);
      if (!v.ok) return v.reply;
      const res = await fd.post("/canned_response_folders", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create folder", res));
    },
  );

  tool(
    server,
    "update_canned_response_folder",
    "Rename a canned response folder. Payload: { name }.",
    { folder_id: folderId, folder: z.record(z.any()).describe("{ name }") },
    async ({ folder_id, folder }) => {
      const v = validate(CannedResponseFolderCreate, folder);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/canned_response_folders/${folder_id}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update folder", res));
    },
  );

  tool(
    server,
    "delete_canned_response_folder",
    "Undocumented endpoint (not in the public API reference) — may return 404 on some accounts. Delete a canned response folder.",
    { folder_id: folderId },
    async ({ folder_id }) => {
      const res = await fd.delete(`/canned_response_folders/${folder_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete folder", res));
    },
  );
}
