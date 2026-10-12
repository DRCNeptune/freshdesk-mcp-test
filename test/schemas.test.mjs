// Payload shapes taken from the Freshdesk API docs must validate; doc-mandatory fields are enforced.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as s from "../dist/schemas/index.js";

const ok = (schema, v) => assert.ok(schema.safeParse(v).success, JSON.stringify(v));
const bad = (schema, v) => assert.ok(!schema.safeParse(v).success, JSON.stringify(v));

test("forum topic uses `message`, comment uses `body`", () => {
  ok(s.TopicCreate, { title: "How to", message: "<p>hi</p>" });
  bad(s.TopicCreate, { title: "How to" });
  ok(s.CommentCreate, { body: "<p>thanks</p>" });
  bad(s.CommentCreate, {});
});

test("forum create requires forum_visibility", () => {
  ok(s.ForumCreate, { name: "F", forum_type: 1, forum_visibility: 1, company_ids: [1] });
  bad(s.ForumCreate, { name: "F", forum_type: 1 });
});

test("reply_to_forward requires to_emails", () => {
  ok(s.ReplyToForwardCreate, { body: "x", to_emails: ["a@b.co"] });
  bad(s.ReplyToForwardCreate, { body: "x" });
});

test("contact/company field create requires agent flags", () => {
  const flags = { agents_can_edit: true, displayed_for_agents: true, quick_add_for_agent: false, unique: false };
  ok(s.ContactFieldCreate, { label: "L", label_for_customers: "L", type: "custom_text", ...flags });
  bad(s.ContactFieldCreate, { label: "L", label_for_customers: "L", type: "custom_text" });
  ok(s.CompanyFieldCreate, { label: "L", type: "custom_text", ...flags });
  bad(s.CompanyFieldCreate, { label: "L", type: "custom_text" });
});

test("mailbox create requires mailbox_type (+custom_mailbox for custom)", () => {
  ok(s.MailboxCreate, { support_email: "s@x.co", mailbox_type: "freshdesk_mailbox", default_reply_email: true });
  bad(s.MailboxCreate, { support_email: "s@x.co" });
  bad(s.MailboxCreate, { support_email: "s@x.co", mailbox_type: "custom_mailbox" });
});

test("contact can be identified by social_handler", () => {
  ok(s.ContactCreate, { name: "N", social_handler: [{ type: "instagram", value: "n" }] });
  bad(s.ContactCreate, { name: "N" });
});

test("ticket create accepts related_ticket_ids (tracker)", () => {
  ok(s.TicketCreate, { email: "a@b.co", subject: "x", related_ticket_ids: [1, 2] });
  bad(s.TicketCreate, { subject: "x" });
});
