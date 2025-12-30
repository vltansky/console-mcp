import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ProjectSkill = {
  id: string;
  title: string;
  description: string;
  body: string;
  sourcePath: string;
};

type LoadOptions = {
  directory?: string;
};

const DEFAULT_SKILLS_DIR = '.console-bridge';
const MD_EXTENSION = /\.md$/i;

export async function loadProjectSkills(
  options: LoadOptions = {},
): Promise<{ skills: ProjectSkill[]; directory?: string }> {
  const baseDirectory = options.directory
    ? path.resolve(options.directory)
    : path.resolve(process.cwd(), DEFAULT_SKILLS_DIR);

  const discoveredSkills: ProjectSkill[] = [];
  let baseDirExists = false;

  try {
    const stats = await fs.stat(baseDirectory);
    if (!stats.isDirectory()) {
      return { skills: [], directory: undefined };
    }
    baseDirExists = true;
    const entries = await fs.readdir(baseDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !MD_EXTENSION.test(entry.name) || entry.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(baseDirectory, entry.name);
      const relative = path.relative(baseDirectory, fullPath);
      const slug = slugify(relative.replace(MD_EXTENSION, ''));
      try {
        const raw = await fs.readFile(fullPath, 'utf8');
        const { metadata, body } = extractFrontMatter(raw);
        const title = metadata.title || toTitleCase(slug);
        const description =
          metadata.description || firstParagraph(body) || 'Project-specific guidance.';
        discoveredSkills.push({
          id: metadata.slug ? slugify(String(metadata.slug)) : slug,
          title,
          description,
          body: body.trim(),
          sourcePath: fullPath,
        });
      } catch (error) {
        console.warn(
          `[console-bridge] Failed to parse skill at ${fullPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(
        `[console-bridge] Unable to read skills directory ${baseDirectory}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return {
    skills: dedupeById(discoveredSkills),
    directory: baseDirExists ? baseDirectory : undefined,
  };
}

function extractFrontMatter(content: string): {
  metadata: Record<string, unknown>;
  body: string;
} {
  const delimiterPattern = /^---\s*[\r\n]+([\s\S]*?)\r?\n---\s*[\r\n]*([\s\S]*)$/;
  const match = content.match(delimiterPattern);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const rawFrontMatter = match[1];
  const body = match[2] ?? '';
  const metadata: Record<string, unknown> = {};
  let currentArrayKey: string | null = null;

  for (const line of rawFrontMatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ') && currentArrayKey) {
      const value = trimmed.slice(2).trim();
      if (!Array.isArray(metadata[currentArrayKey])) {
        metadata[currentArrayKey] = [];
      }
      (metadata[currentArrayKey] as unknown[]).push(value);
      continue;
    }

    const [key, ...rest] = trimmed.split(':');
    if (!key) continue;
    const value = rest.join(':').trim();
    if (!value) {
      currentArrayKey = key.trim();
      metadata[currentArrayKey] = [];
      continue;
    }
    currentArrayKey = null;
    metadata[key.trim()] = stripQuotes(value);
  }

  return { metadata, body };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function toTitleCase(slug: string): string {
  return slug
    .split(/[-_/]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function firstParagraph(markdown: string): string | undefined {
  const cleaned = markdown.trim();
  if (!cleaned) return undefined;
  const paragraph = cleaned.split(/\n{2,}/)[0];
  return paragraph.replace(/[#>*`]/g, '').trim();
}

function dedupeById(skills: ProjectSkill[]): ProjectSkill[] {
  const map = new Map<string, ProjectSkill>();
  for (const skill of skills) {
    if (!skill.id) continue;
    if (!map.has(skill.id)) {
      map.set(skill.id, skill);
      continue;
    }
    // If duplicate slug, append suffix to keep both
    let counter = 2;
    let nextId = `${skill.id}-${counter}`;
    while (map.has(nextId)) {
      counter += 1;
      nextId = `${skill.id}-${counter}`;
    }
    map.set(nextId, { ...skill, id: nextId });
  }
  return Array.from(map.values());
}
