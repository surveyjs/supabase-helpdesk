/**
 * Email parsing utilities for inbound email processing.
 * These are pure functions extracted to a non-'use server' module
 * so they can be exported and unit-tested independently.
 */

/**
 * Strip common email signature patterns from message body.
 * Handles: "-- " separator, "___" delimiter, "Sent from my iPhone/iPad/Android",
 * "Get Outlook for", forwarded message headers, and quoted reply blocks (> lines).
 *
 * Returns the original body if stripping results in empty content.
 */
export function stripEmailSignature(body: string): string {
  if (!body) return '';

  // Normalize CRLF to LF so signature delimiters match reliably
  const lines = body.split(/\r?\n/);
  let cutIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Standard signature separator "-- " (with trailing space)
    if (line === '-- ' || line === '--') {
      cutIndex = i;
      break;
    }

    // 3+ underscores
    if (/^_{3,}\s*$/.test(line)) {
      cutIndex = i;
      break;
    }

    // "Sent from my iPhone/iPad/Android"
    if (/^Sent from my (iPhone|iPad|Android)/i.test(line.trim())) {
      cutIndex = i;
      break;
    }

    // "Get Outlook for"
    if (/^Get Outlook for/i.test(line.trim())) {
      cutIndex = i;
      break;
    }

    // Forwarded message header
    if (/^-{5,}\s*Forwarded message\s*-{5,}/i.test(line)) {
      cutIndex = i;
      break;
    }
  }

  // Take content above the delimiter
  let result = lines.slice(0, cutIndex).join('\n');

  // Strip quoted reply blocks (lines starting with ">")
  result = result
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('>'))
    .join('\n');

  // Trim whitespace
  result = result.trim();

  // If stripping results in empty content, return the original body as fallback
  if (!result) return body.trim();

  return result;
}

/**
 * Extract ticket ID from email subject containing [Ticket #123] pattern.
 * Returns the ticket ID as a number, or null if no match found.
 */
export function extractTicketIdFromSubject(subject: string): number | null {
  const match = subject.match(/\[Ticket #(\d+)\]/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return isNaN(id) ? null : id;
}
