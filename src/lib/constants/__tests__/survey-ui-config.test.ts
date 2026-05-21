import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE,
  DEFAULT_TICKET_DETAIL_USER_TEMPLATE,
  findInvalidTicketDetailQuestionNames,
  isCustomFieldQuestionName,
  customFieldNameFromQuestion,
  parseTicketDetailAgentTemplate,
  parseTicketDetailUserTemplate,
} from '../survey-ui-config';

describe('survey-ui-config custom-field helpers', () => {
  it('defaults autoGenerateCustomFields=true', () => {
    expect(DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE.autoGenerateCustomFields).toBe(true);
    expect(DEFAULT_TICKET_DETAIL_USER_TEMPLATE.autoGenerateCustomFields).toBe(true);
  });

  it('parses missing autoGenerateCustomFields as true', () => {
    const raw = JSON.stringify({
      template: DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE.template,
      tierControlRules: DEFAULT_TICKET_DETAIL_AGENT_TEMPLATE.tierControlRules,
    });
    expect(parseTicketDetailAgentTemplate(raw).autoGenerateCustomFields).toBe(true);
  });

  it('preserves explicit autoGenerateCustomFields=false', () => {
    const raw = JSON.stringify({
      template: DEFAULT_TICKET_DETAIL_USER_TEMPLATE.template,
      tierControlRules: DEFAULT_TICKET_DETAIL_USER_TEMPLATE.tierControlRules,
      autoGenerateCustomFields: false,
    });
    expect(parseTicketDetailUserTemplate(raw).autoGenerateCustomFields).toBe(false);
  });

  it('isCustomFieldQuestionName matches/rejects per convention', () => {
    expect(isCustomFieldQuestionName('custom_fields.foo')).toBe(true);
    expect(isCustomFieldQuestionName('custom_fields.with-dash_1 spaces')).toBe(true);
    expect(isCustomFieldQuestionName('custom_fields.')).toBe(false);
    expect(isCustomFieldQuestionName('custom_field.foo')).toBe(false);
    expect(isCustomFieldQuestionName('status')).toBe(false);
  });

  it('customFieldNameFromQuestion extracts bare name', () => {
    expect(customFieldNameFromQuestion('custom_fields.foo')).toBe('foo');
    expect(customFieldNameFromQuestion('status')).toBeNull();
  });

  it('findInvalidTicketDetailQuestionNames tolerates custom_fields.*', () => {
    const tpl = {
      elements: [
        { type: 'text', name: 'status' },
        { type: 'text', name: 'custom_fields.priority' },
      ],
    };
    expect(findInvalidTicketDetailQuestionNames(tpl)).toEqual([]);
  });

  it('findInvalidTicketDetailQuestionNames rejects malformed custom_fields prefix', () => {
    const tpl = {
      elements: [
        { type: 'text', name: 'custom_fields.' },
        { type: 'text', name: 'custom_field.foo' },
      ],
    };
    const invalid = findInvalidTicketDetailQuestionNames(tpl);
    expect(invalid).toContain('custom_fields.');
    expect(invalid).toContain('custom_field.foo');
  });
});
