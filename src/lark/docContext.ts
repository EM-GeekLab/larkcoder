const PLAN_HEADINGS = ["plan", "规划", "计划"];

export function extractPlanFromMarkdown(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  let startIndex = -1;
  let endIndex = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const heading = parseHeading(line);
    if (!heading) {
      continue;
    }

    if (startIndex === -1 && isPlanHeading(heading)) {
      startIndex = index + 1;
      continue;
    }

    if (startIndex !== -1) {
      endIndex = index;
      break;
    }
  }

  if (startIndex === -1) {
    return normalized.trim();
  }

  const section = lines.slice(startIndex, endIndex).join("\n").trim();
  return section.length > 0 ? section : normalized.trim();
}

function parseHeading(line: string): string | null {
  const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
  if (!match) {
    return null;
  }
  return match[2]?.trim() ?? null;
}

function isPlanHeading(text: string): boolean {
  const normalized = text.toLowerCase();
  return PLAN_HEADINGS.some((keyword) => normalized.includes(keyword));
}
