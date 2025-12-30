# Create Browser Skill

<purpose>
Create a browser skill (project-specific debugging playbook) that teaches the AI assistant how to debug this specific project using console-bridge MCP tools.
</purpose>

<context>
Browser skills are markdown files stored in `.console-bridge/` that provide project-specific guidance for debugging workflows. They're automatically discovered by console-bridge and exposed via `console_skills_list` and `console_skills_load` MCP tools.
</context>

<prerequisites>
- Project root contains `.console-bridge/` directory (create if missing)
</prerequisites>

<available_tools>
| Tool | Description |
|------|-------------|
| `console_tabs` | List/suggest browser tabs |
| `console_logs` | Query logs (list/get/tail) |
| `console_search` | Search logs (regex/keywords) |
| `console_browser_execute` | Execute JavaScript in page |
| `console_browser_query` | Query DOM elements |
| `console_snapshot` | Get log statistics |
| `console_skills_list` | List available skills |
| `console_skills_load` | Load skill content |
</available_tools>

<file_structure>
- **Directory**: `.console-bridge/` (project root)
- **Filename**: `{skill-name}.md` (kebab-case)
- **Format**: Markdown with YAML front-matter
</file_structure>

<template>
```markdown
---
title: Skill Title
description: Brief description of what this skill teaches
---

# Skill Title

Detailed markdown content explaining:
- When to use this skill
- Step-by-step workflow
- Common patterns to look for
- Project-specific hints (ports, URLs, feature flags)
- Troubleshooting tips
```
</template>

<front_matter_fields>
<required>
- `title` (string): Human-readable skill name
- `description` (string): Brief summary (used in skill listings)
</required>

<optional>
- `slug` (string): Custom identifier (auto-generated from filename if omitted)
</optional>
</front_matter_fields>

<examples>
<example name="Checkout Flow Debugging">
```markdown
---
title: Checkout Flow Smoke Test
description: How to target checkout tabs + common log filters
---

# Checkout Flow Smoke Test

Start by running `console_tabs` with `urlPatterns: ["localhost:4000/checkout"]` and prefer results whose `lastNavigationAt` is within the last 5 minutes.

Common errors to look for:
- Payment gateway timeouts (search for "stripe" or "payment")
- Cart validation failures (filter by level: "error" and URL pattern: "/checkout")
- Shipping calculation errors (search keywords: ["shipping", "calculate"])

Use `console_browser_execute` to toggle checkout debug mode: `window.checkout.debug()`
```
</example>

<example name="Authentication Debugging">
```markdown
---
title: Auth Flow Debugging
description: Debug authentication errors and token refresh issues
---

# Auth Flow Debugging

This project uses JWT tokens with automatic refresh. Common issues:

1. **Token Expiry**: Search for "token expired" or "401" errors
2. **Refresh Failures**: Look for "refresh" + "error" keywords
3. **CORS Issues**: Filter by URL pattern matching API endpoints

The auth service runs on port 3000. Use `sessionScope: "current"` to focus on logs after page refresh.
```
</example>

<example name="Multi-Tab Development">
```markdown
---
title: Multi-Project Tab Selection
description: Help AI identify the correct tab when working on multiple projects
---

# Multi-Project Tab Selection

This monorepo runs multiple dev servers:
- **Frontend**: `localhost:3000` (React)
- **Storybook**: `localhost:6006` (Component library)
- **API**: `localhost:8080` (Express)

When suggesting tabs, prioritize:
1. Active tab (`isActive: true`)
2. Most recent navigation (`lastNavigationAt` within last 2 minutes)
3. Matching dev server ports

Use `console_tabs` with `ports: [3000, 6006, 8080]` to filter local development tabs.
```
</example>
</examples>

<best_practices>
- **Be Specific**: Include project-specific details (ports, URLs, feature flags)
- **Provide Context**: Explain WHY, not just WHAT
- **Include Examples**: Show concrete MCP tool calls with realistic parameters
- **Keep Focused**: One skill per debugging scenario
</best_practices>

<workflow>
1. Identify debugging scenario that needs a playbook
2. Create `.console-bridge/{skill-name}.md`
3. Write front-matter (title, description)
4. Write body content in markdown
5. Verify with `console_skills_list` (skill should appear)
6. Test with `console_skills_load(slug: "{skill-name}")`
</workflow>

<notes>
- Skills are auto-discovered on console-bridge startup
- Filename becomes the slug (kebab-case recommended)
- Front-matter uses YAML syntax (arrays with `-` bullets)
- Skills work across projects when using `projectPath` parameter
</notes>
