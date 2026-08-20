export type CompanyDescriptionSource = "source" | "job_description";

export type ResolvedCompanyDescription = {
  description: string;
  source: CompanyDescriptionSource;
};

type CompanyDescriptionInput = {
  employer: string;
  companyDescription?: string | null;
  jobDescription?: string | null;
};

const MAX_DESCRIPTION_LENGTH = 2_000;
const MIN_EXTRACTED_LENGTH = 40;

const decodeBasicEntities = (value: string) =>
  value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const toPlainText = (value: string) =>
  decodeBasicEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const truncate = (value: string) => {
  if (value.length <= MAX_DESCRIPTION_LENGTH) return value;
  const shortened = value.slice(0, MAX_DESCRIPTION_LENGTH);
  const boundary = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("\n"),
  );
  return `${shortened.slice(0, boundary > 500 ? boundary + 1 : MAX_DESCRIPTION_LENGTH).trim()}…`;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeHeadingLine = (line: string) =>
  line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*?)\**$/, "$1")
    .trim();

const isSectionBoundary = (line: string) => {
  const normalized = normalizeHeadingLine(line).replace(/:$/, "").trim();
  if (normalized.length > 100) return false;
  return /^(?:about (?:the )?(?:role|job|position|team)|the (?:role|job|position)|role (?:overview|description)|what you(?:'|’)ll do|what we(?:'|’)re looking for|responsibilities|requirements|qualifications|skills|experience|education|benefits|compensation|salary|location|how to apply|equal opportunity|diversity|our values)$/i.test(
    normalized,
  );
};

const extractCompanySection = (jobDescription: string, employer: string) => {
  const lines = toPlainText(jobDescription).split("\n");
  const employerPattern = employer.trim()
    ? `|about\\s+${escapeRegex(employer.trim())}`
    : "";
  const headingPattern = new RegExp(
    `^(?:about\\s+(?:the\\s+)?company|about\\s+us|who\\s+we\\s+are|company\\s+(?:overview|profile)|our\\s+company${employerPattern})\\s*:?\\s*(.*)$`,
    "i",
  );

  for (let index = 0; index < lines.length; index += 1) {
    const heading = normalizeHeadingLine(lines[index]);
    const match = heading.match(headingPattern);
    if (!match) continue;

    const sectionLines = match[1]?.trim() ? [match[1].trim()] : [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (isSectionBoundary(lines[cursor])) break;
      sectionLines.push(lines[cursor]);
      if (sectionLines.join("\n").length >= MAX_DESCRIPTION_LENGTH) break;
    }

    const extracted = truncate(sectionLines.join("\n").trim());
    if (extracted.length >= MIN_EXTRACTED_LENGTH) return extracted;
  }

  return null;
};

export function resolveCompanyDescription({
  employer,
  companyDescription,
  jobDescription,
}: CompanyDescriptionInput): ResolvedCompanyDescription | null {
  const sourceDescription = companyDescription
    ? truncate(toPlainText(companyDescription))
    : "";
  if (sourceDescription) {
    return { description: sourceDescription, source: "source" };
  }

  const extracted = jobDescription
    ? extractCompanySection(jobDescription, employer)
    : null;
  return extracted
    ? { description: extracted, source: "job_description" }
    : null;
}
