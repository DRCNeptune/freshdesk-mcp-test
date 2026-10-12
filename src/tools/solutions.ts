import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorPayload, fd } from "../freshdesk.js";
import {
  SolutionArticleCreate,
  SolutionArticleUpdate,
  SolutionCategoryCreate,
  SolutionCategoryUpdate,
  SolutionFolderCreate,
  SolutionFolderUpdate,
} from "../schemas/index.js";
import { lang, langArg, text, tool, validate } from "../util.js";

const categoryId = z.number().int().describe("Solution category ID.");
const folderId = z.number().int().describe("Solution folder ID.");
const articleId = z.number().int().describe("Solution article ID.");
const FOLDER_FIELDS =
  "name (required, unique in category), description, visibility (1=all 2=logged-in users 3=agents 4=selected companies " +
  "5=selected contact segments 6=selected company segments), company_ids[] / contact_segment_ids[] / company_segment_ids[] (for 4/5/6), parent_folder_id (subfolder)";
const ARTICLE_FIELDS =
  "title, description (HTML), status (1=draft 2=published), type (1=permanent 2=workaround), agent_id (author), tags[], " +
  "seo_data{meta_title, meta_description, meta_keywords}, review_date";

export function registerSolutionTools(server: McpServer) {
  tool(
    server,
    "search_solution_articles",
    "Keyword search across Knowledge Base articles (title + body). Returns matching articles with category/folder names. " +
      "Use this first when looking for help content to answer a customer.",
    { term: z.string().describe("Search keyword(s).") },
    async ({ term }) => {
      const res = await fd.get("/search/solutions", { term });
      return text(res.ok ? res.data : errorPayload("Failed to search articles", res));
    },
  );

  // ─── Categories ───────────────────────────────────
  tool(
    server,
    "list_solution_categories",
    "List Knowledge Base categories (top level of category → folder → article).",
    { language: langArg },
    async ({ language }) => {
      const res = await fd.get(`/solutions/categories${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to list categories", res));
    },
  );

  tool(
    server,
    "view_solution_category",
    "Get one Knowledge Base category.",
    { category_id: categoryId, language: langArg },
    async ({ category_id, language }) => {
      const res = await fd.get(`/solutions/categories/${category_id}${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to view category", res));
    },
  );

  tool(
    server,
    "create_solution_category",
    "Create a Knowledge Base category. Payload: name (required, unique), description, visible_in_portals[] (portal IDs).",
    { category: z.record(z.any()).describe("Category payload.") },
    async ({ category }) => {
      const v = validate(SolutionCategoryCreate, category);
      if (!v.ok) return v.reply;
      const res = await fd.post("/solutions/categories", v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create category", res));
    },
  );

  tool(
    server,
    "update_solution_category",
    "Update a category (or its translation when language is set); only sent keys change.",
    {
      category_id: categoryId,
      category: z.record(z.any()).describe("Fields to change."),
      language: langArg,
    },
    async ({ category_id, category, language }) => {
      const v = validate(SolutionCategoryUpdate, category);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/solutions/categories/${category_id}${lang(language)}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update category", res));
    },
  );

  tool(
    server,
    "delete_solution_category",
    "Delete a category and EVERYTHING inside it (folders and articles). Irreversible.",
    { category_id: categoryId },
    async ({ category_id }) => {
      const res = await fd.delete(`/solutions/categories/${category_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete category", res));
    },
  );

  // ─── Folders ──────────────────────────────────────
  tool(
    server,
    "list_solution_folders",
    "List top-level folders in a category (with articles_count, sub_folders_count, visibility).",
    { category_id: categoryId, language: langArg },
    async ({ category_id, language }) => {
      const res = await fd.get(`/solutions/categories/${category_id}/folders${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to list folders", res));
    },
  );

  tool(
    server,
    "list_solution_subfolders",
    "List subfolders nested inside a folder.",
    { folder_id: folderId, language: langArg },
    async ({ folder_id, language }) => {
      const res = await fd.get(`/solutions/folders/${folder_id}/subfolders${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to list subfolders", res));
    },
  );

  tool(
    server,
    "view_solution_category_folder",
    "Get one Knowledge Base folder.",
    { folder_id: folderId, language: langArg },
    async ({ folder_id, language }) => {
      const res = await fd.get(`/solutions/folders/${folder_id}${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to view folder", res));
    },
  );

  tool(
    server,
    "create_solution_category_folder",
    `Create a folder in a category. Fields: ${FOLDER_FIELDS}.`,
    { category_id: categoryId, folder: z.record(z.any()).describe("Folder payload.") },
    async ({ category_id, folder }) => {
      const v = validate(SolutionFolderCreate, folder);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/solutions/categories/${category_id}/folders`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create folder", res));
    },
  );

  tool(
    server,
    "update_solution_category_folder",
    `Update a folder (or its translation when language is set); only sent keys change. Fields: ${FOLDER_FIELDS}.`,
    {
      folder_id: folderId,
      folder: z.record(z.any()).describe("Fields to change."),
      language: langArg,
    },
    async ({ folder_id, folder, language }) => {
      const v = validate(SolutionFolderUpdate, folder);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/solutions/folders/${folder_id}${lang(language)}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update folder", res));
    },
  );

  tool(
    server,
    "delete_solution_category_folder",
    "Delete a folder and all its articles/subfolders. Irreversible.",
    { folder_id: folderId },
    async ({ folder_id }) => {
      const res = await fd.delete(`/solutions/folders/${folder_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete folder", res));
    },
  );

  // ─── Articles ─────────────────────────────────────
  tool(
    server,
    "list_solution_articles",
    "List articles in a folder (full content included).",
    { folder_id: folderId, language: langArg },
    async ({ folder_id, language }) => {
      const res = await fd.get(`/solutions/folders/${folder_id}/articles${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to list articles", res));
    },
  );

  tool(
    server,
    "view_solution_article",
    "Get one article with HTML description, status, tags, hits and thumbs up/down.",
    { article_id: articleId, language: langArg },
    async ({ article_id, language }) => {
      const res = await fd.get(`/solutions/articles/${article_id}${lang(language)}`);
      return text(res.ok ? res.data : errorPayload("Failed to view article", res));
    },
  );

  tool(
    server,
    "create_solution_article",
    `Create an article in a folder. Required: title, description, status. Fields: ${ARTICLE_FIELDS}.`,
    { folder_id: folderId, article: z.record(z.any()).describe("Article payload.") },
    async ({ folder_id, article }) => {
      const v = validate(SolutionArticleCreate, article);
      if (!v.ok) return v.reply;
      const res = await fd.post(`/solutions/folders/${folder_id}/articles`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to create article", res));
    },
  );

  tool(
    server,
    "update_solution_article",
    `Update an article (or its translation when language is set); only sent keys change. Set status=2 to publish. Fields: ${ARTICLE_FIELDS}.`,
    {
      article_id: articleId,
      article: z.record(z.any()).describe("Fields to change."),
      language: langArg,
    },
    async ({ article_id, article, language }) => {
      const v = validate(SolutionArticleUpdate, article);
      if (!v.ok) return v.reply;
      const res = await fd.put(`/solutions/articles/${article_id}${lang(language)}`, v.data);
      return text(res.ok ? res.data : errorPayload("Failed to update article", res));
    },
  );

  tool(
    server,
    "delete_solution_article",
    "Delete an article (all translations). Irreversible.",
    { article_id: articleId },
    async ({ article_id }) => {
      const res = await fd.delete(`/solutions/articles/${article_id}`);
      if (res.status === 204) return text({ success: true });
      return text(errorPayload("Failed to delete article", res));
    },
  );

  // ─── Translations ─────────────────────────────────
  tool(
    server,
    "create_solution_translation",
    "Add a translation of an existing category, folder or article (multilingual Knowledge Base must be enabled). " +
      "Payload uses the same fields as the original (category: name, description; folder: name, description; article: title, description, status).",
    {
      kind: z.enum(["category", "folder", "article"]).describe("What to translate."),
      id: z.number().int().describe("ID of the existing category/folder/article."),
      language: z.string().describe("Target language code, e.g. 'fr'."),
      translation: z.record(z.any()).describe("Translated content."),
    },
    async ({ kind, id, language, translation }) => {
      const res = await fd.post(
        `/solutions/${kind === "category" ? "categories" : `${kind}s`}/${id}${lang(language)}`,
        translation,
      );
      return text(res.ok ? res.data : errorPayload("Failed to create translation", res));
    },
  );
}
