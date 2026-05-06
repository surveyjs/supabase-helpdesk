import type { SurveyJsonDefinition } from '@/lib/constants/survey-ui-config';
import type { TicketDetailFieldPolicy } from './ticket-detail-policy';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Choice = { value: string; text: string };

export type TicketDetailChoiceMap = {
  type_id?: Choice[];
  category_id?: Choice[];
  assigned_agent_id?: Choice[];
  tag_ids?: Choice[];
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Recursively trim hidden questions and flag read-only ones according to
 * the supplied policy. Elements without a `name` are passed through.
 */
function applyToElements(
  elements: unknown[],
  policy: TicketDetailFieldPolicy,
): unknown[] {
  const next: unknown[] = [];
  for (const el of elements) {
    if (!isRecord(el)) continue;
    if (Array.isArray(el.elements)) {
      el.elements = applyToElements(el.elements as unknown[], policy);
    }
    if (typeof el.name === 'string') {
      const rule = policy[el.name];
      if (rule && rule.visible === false) continue;
      if (rule && rule.editable === false) {
        el.readOnly = true;
      }
    }
    next.push(el);
  }
  return next;
}

export function applyTemplatePolicy(
  template: SurveyJsonDefinition,
  policy: TicketDetailFieldPolicy,
): SurveyJsonDefinition {
  const cloned = deepClone(template);
  const pages = (cloned as { pages?: unknown[] }).pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (!isRecord(page)) continue;
      if (Array.isArray(page.elements)) {
        page.elements = applyToElements(page.elements as unknown[], policy);
      }
    }
  }
  // Top-level elements (rare in our schemas, but support both)
  const topElements = (cloned as { elements?: unknown[] }).elements;
  if (Array.isArray(topElements)) {
    (cloned as { elements: unknown[] }).elements = applyToElements(topElements, policy);
  }
  return cloned;
}

/**
 * Inject runtime choices for dynamic dropdowns/tagboxes after trimming.
 * Mutates and returns the template.
 */
export function injectTemplateChoices(
  template: SurveyJsonDefinition,
  choices: TicketDetailChoiceMap,
): SurveyJsonDefinition {
  function walk(node: unknown) {
    if (!isRecord(node)) return;
    if (typeof node.name === 'string' && choices[node.name as keyof TicketDetailChoiceMap]) {
      node.choices = choices[node.name as keyof TicketDetailChoiceMap]!;
    }
    if (Array.isArray(node.elements)) node.elements.forEach(walk);
    if (Array.isArray(node.pages)) node.pages.forEach(walk);
  }
  walk(template);
  return template;
}
