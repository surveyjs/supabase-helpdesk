import {
  CUSTOM_FIELD_QUESTION_PREFIX,
  isCustomFieldQuestionName,
  type SurveyJsonDefinition,
} from '@/lib/constants/survey-ui-config';

export type CustomFieldDef = {
  id: string;
  name: string;
  field_type: 'text' | 'number' | 'dropdown' | 'checkbox' | 'date';
  is_required: boolean;
  options: string[] | null;
  default_value: string | null;
  display_order: number;
};

/**
 * Legacy panel name retained for backwards-compatible stripping of
 * previously-injected `custom_fields_panel` containers from stored
 * templates. Current injection appends questions flat (no wrapper
 * panel), so this constant is only used by `stripExistingCustomFieldNodes`.
 */
export const CUSTOM_FIELDS_PANEL_NAME = 'custom_fields_panel';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseDefault(def: CustomFieldDef): unknown {
  const raw = def.default_value;
  if (raw == null || raw === '') return undefined;
  switch (def.field_type) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'checkbox':
      return raw === 'true' || raw === 'on' || raw === '1';
    case 'text':
    case 'dropdown':
    case 'date':
    default:
      return raw;
  }
}

function buildQuestion(def: CustomFieldDef): Record<string, unknown> {
  const questionName = `${CUSTOM_FIELD_QUESTION_PREFIX}${def.name}`;
  const base: Record<string, unknown> = {
    name: questionName,
    title: def.name,
    isRequired: def.is_required,
  };
  const dflt = parseDefault(def);
  if (dflt !== undefined && def.field_type !== 'checkbox') {
    base.defaultValue = dflt;
  }
  switch (def.field_type) {
    case 'text':
      base.type = 'text';
      base.maxLength = 1000;
      break;
    case 'number':
      base.type = 'text';
      base.inputType = 'number';
      break;
    case 'dropdown':
      base.type = 'dropdown';
      base.choices = def.options ?? [];
      base.allowClear = !def.is_required;
      break;
    case 'checkbox':
      base.type = 'boolean';
      if (dflt !== undefined) base.defaultValue = dflt;
      break;
    case 'date':
      base.type = 'text';
      base.inputType = 'date';
      break;
  }
  return base;
}

/**
 * Build a flat list of SurveyJS question elements, one per custom
 * field definition, ordered by `display_order` then `name`. Returns
 * an empty array when there are no definitions. The questions are
 * appended directly to the page (no wrapping panel) so no extra
 * label or separator is rendered.
 */
export function buildCustomFieldQuestions(
  defs: CustomFieldDef[],
): Array<Record<string, unknown>> {
  if (defs.length === 0) return [];
  const sorted = [...defs].sort((a, b) => {
    if (a.display_order !== b.display_order) return a.display_order - b.display_order;
    return a.name.localeCompare(b.name);
  });
  return sorted.map(buildQuestion);
}

function stripExistingCustomFieldNodes(elements: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const el of elements) {
    if (!isRecord(el)) continue;
    if (el.name === CUSTOM_FIELDS_PANEL_NAME) continue;
    if (typeof el.name === 'string' && isCustomFieldQuestionName(el.name)) continue;
    if (Array.isArray(el.elements)) {
      el.elements = stripExistingCustomFieldNodes(el.elements as unknown[]);
    }
    out.push(el);
  }
  return out;
}

/**
 * Clone `template`, strip any pre-existing `custom_fields_panel` panel
 * (legacy) and stray `custom_fields.*` questions, then append freshly
 * generated custom-field questions directly to the last page (creating
 * a page if none exists). No wrapper panel or section title is added,
 * so no extra label or separator appears in the rendered form. No-op
 * when `defs` is empty (the strip still runs to remove stale
 * authoring).
 *
 * NOTE: despite the name, this function no longer wraps questions in a
 * panel. The name is retained to avoid a churny rename across call sites
 * and tests; see `CUSTOM_FIELDS_PANEL_NAME` for the legacy-strip target.
 */
export function injectCustomFieldsPanel(
  template: SurveyJsonDefinition,
  defs: CustomFieldDef[],
): SurveyJsonDefinition {
  const cloned = deepClone(template) as Record<string, unknown>;

  const pages = Array.isArray(cloned.pages) ? (cloned.pages as unknown[]) : null;
  if (pages) {
    for (const page of pages) {
      if (!isRecord(page)) continue;
      if (Array.isArray(page.elements)) {
        page.elements = stripExistingCustomFieldNodes(page.elements as unknown[]);
      }
    }
  }
  if (Array.isArray(cloned.elements)) {
    cloned.elements = stripExistingCustomFieldNodes(cloned.elements as unknown[]);
  }

  if (defs.length === 0) return cloned as SurveyJsonDefinition;

  const questions = buildCustomFieldQuestions(defs);
  if (questions.length === 0) return cloned as SurveyJsonDefinition;

  if (pages && pages.length > 0) {
    const lastPage = pages[pages.length - 1];
    if (isRecord(lastPage)) {
      const els = Array.isArray(lastPage.elements) ? (lastPage.elements as unknown[]) : [];
      lastPage.elements = [...els, ...questions];
    }
  } else if (Array.isArray(cloned.elements)) {
    cloned.elements = [...(cloned.elements as unknown[]), ...questions];
  } else {
    cloned.pages = [{ name: 'page1', elements: questions }];
  }

  return cloned as SurveyJsonDefinition;
}
