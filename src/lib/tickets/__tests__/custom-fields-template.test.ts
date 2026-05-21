import { describe, expect, it } from 'vitest';
import {
  buildCustomFieldsPanel,
  CUSTOM_FIELDS_PANEL_NAME,
  injectCustomFieldsPanel,
  type CustomFieldDef,
} from '../custom-fields-template';

function def(partial: Partial<CustomFieldDef> & { name: string; field_type: CustomFieldDef['field_type'] }): CustomFieldDef {
  return {
    id: partial.id ?? partial.name,
    name: partial.name,
    field_type: partial.field_type,
    is_required: partial.is_required ?? false,
    options: partial.options ?? null,
    default_value: partial.default_value ?? null,
    display_order: partial.display_order ?? 0,
  };
}

describe('buildCustomFieldsPanel', () => {
  it('returns null on empty input', () => {
    expect(buildCustomFieldsPanel([])).toBeNull();
  });

  it('builds questions per type with correct mapping', () => {
    const panel = buildCustomFieldsPanel([
      def({ name: 'priority', field_type: 'dropdown', options: ['low', 'high'], is_required: true }),
      def({ name: 'count', field_type: 'number', default_value: '5' }),
      def({ name: 'note', field_type: 'text' }),
      def({ name: 'urgent', field_type: 'checkbox', default_value: 'true' }),
      def({ name: 'due', field_type: 'date' }),
    ]);
    expect(panel).not.toBeNull();
    expect(panel!.name).toBe(CUSTOM_FIELDS_PANEL_NAME);
    const els = (panel!.elements as Array<Record<string, unknown>>);
    const byName = Object.fromEntries(els.map((e) => [e.name, e]));

    expect(byName['custom_fields.priority']).toMatchObject({
      type: 'dropdown',
      choices: ['low', 'high'],
      isRequired: true,
      allowClear: false,
    });
    expect(byName['custom_fields.count']).toMatchObject({
      type: 'text',
      inputType: 'number',
      defaultValue: 5,
    });
    expect(byName['custom_fields.note']).toMatchObject({
      type: 'text',
      maxLength: 1000,
    });
    expect(byName['custom_fields.urgent']).toMatchObject({
      type: 'boolean',
      defaultValue: true,
    });
    expect(byName['custom_fields.due']).toMatchObject({
      type: 'text',
      inputType: 'date',
    });
  });

  it('sorts by display_order then name', () => {
    const panel = buildCustomFieldsPanel([
      def({ name: 'b', field_type: 'text', display_order: 2 }),
      def({ name: 'c', field_type: 'text', display_order: 1 }),
      def({ name: 'a', field_type: 'text', display_order: 1 }),
    ]);
    const names = (panel!.elements as Array<Record<string, unknown>>).map((e) => e.name);
    expect(names).toEqual(['custom_fields.a', 'custom_fields.c', 'custom_fields.b']);
  });
});

describe('injectCustomFieldsPanel', () => {
  it('strips pre-existing panel and stray questions then re-injects', () => {
    const tpl = {
      pages: [
        {
          elements: [
            { type: 'text', name: 'status' },
            { type: 'text', name: 'custom_fields.stale' },
            { type: 'panel', name: CUSTOM_FIELDS_PANEL_NAME, elements: [] },
          ],
        },
      ],
    };
    const out = injectCustomFieldsPanel(tpl, [def({ name: 'fresh', field_type: 'text' })]);
    const pageEls = (out as { pages: Array<{ elements: Array<Record<string, unknown>> }> }).pages[0].elements;
    expect(pageEls.find((e) => e.name === 'status')).toBeTruthy();
    expect(pageEls.find((e) => e.name === 'custom_fields.stale')).toBeUndefined();
    const panels = pageEls.filter((e) => e.name === CUSTOM_FIELDS_PANEL_NAME);
    expect(panels).toHaveLength(1);
    const els = panels[0].elements as Array<Record<string, unknown>>;
    expect(els.map((e) => e.name)).toEqual(['custom_fields.fresh']);
  });

  it('is a no-op (apart from stripping) when defs is empty', () => {
    const tpl = { pages: [{ elements: [{ type: 'text', name: 'status' }] }] };
    const out = injectCustomFieldsPanel(tpl, []);
    const els = (out as { pages: Array<{ elements: Array<Record<string, unknown>> }> }).pages[0].elements;
    expect(els.find((e) => e.name === CUSTOM_FIELDS_PANEL_NAME)).toBeUndefined();
  });
});
