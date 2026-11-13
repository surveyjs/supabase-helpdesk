import type { QuestionBooleanModel, QuestionTagboxModel, SurveyModel } from 'survey-core';

/**
 * A boolean question with no value renders as an indeterminate ("mixed")
 * checkbox. In the ticket sidebar "no value" means "not set", which reads as
 * unchecked, so give every empty boolean its false value.
 *
 * The values go in through `mergeData`, which does not raise `onValueChanged`,
 * so nothing is dispatched for saving: the ticket keeps no value for the field
 * until the user toggles it.
 */
export function uncheckEmptyBooleans(model: SurveyModel): void {
  const unset: Record<string, unknown> = {};
  for (const q of model.getAllQuestions()) {
    if (q.getType() !== 'boolean' || !q.isEmpty()) continue;
    unset[q.getValueName()] = (q as QuestionBooleanModel).getValueFalse();
  }
  if (Object.keys(unset).length > 0) model.mergeData(unset);
}

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// Chip colour tokens: border in the tag colour, background a 10 % tint.
const CHIP_TOKENS = {
  border: [
    '--sjs2-color-component-tagbox-item-default-border',
    '--sjs2-color-component-tagbox-item-hovered-border',
    '--sjs2-color-component-tagbox-item-readonly-border',
  ],
  // The clear-button mask fades from the hovered background, so it follows it.
  background: [
    '--sjs2-color-component-tagbox-item-default-bg',
    '--sjs2-color-component-tagbox-item-hovered-bg',
    '--sjs2-color-component-tagbox-item-readonly-bg',
    '--sjs2-color-component-tagbox-item-hovered-mask-stop-1',
  ],
};

/**
 * Paint the selected-item chips of a rendered tagbox with their tag colours.
 * `values[i]` is the value of the i-th chip. The label keeps the default
 * text colour, which stays readable on a 10 % tint.
 */
function paintTagChips(
  root: HTMLElement,
  values: unknown[],
  colorByValue: Record<string, string>,
): void {
  const chips = root.querySelectorAll<HTMLElement>('.sd-tagbox-item');
  chips.forEach((chip, i) => {
    const color = colorByValue[String(values[i])];
    const valid = typeof color === 'string' && HEX_COLOR_RE.test(color);
    for (const token of CHIP_TOKENS.border) {
      if (valid) chip.style.setProperty(token, color);
      else chip.style.removeProperty(token);
    }
    for (const token of CHIP_TOKENS.background) {
      if (valid) chip.style.setProperty(token, `color-mix(in srgb, ${color} 10%, white)`);
      else chip.style.removeProperty(token);
    }
  });
}

/**
 * Keep the chips of tagbox `questionName` coloured by tag: paint them from the
 * survey's after-render hook, and again after each value change of that
 * question (the chips re-render, so paint on the next frame). Call before the
 * model first renders.
 */
export function colorTagChips(
  model: SurveyModel,
  questionName: string,
  colorByValue: Record<string, string>,
): void {
  let root: HTMLElement | null = null;
  let frame = 0;
  const paint = () => {
    const q = model.getQuestionByName(questionName) as QuestionTagboxModel | null;
    if (!root || !q) return;
    // The chips are exactly `selectedChoices`, in that order.
    paintTagChips(root, q.selectedChoices.map((c) => c.value), colorByValue);
  };
  model.onAfterRenderQuestion.add((_sender, options) => {
    if (options.question.name !== questionName) return;
    root = options.htmlElement;
    paint();
  });
  model.onValueChanged.add((_sender, options) => {
    if (options.name !== questionName) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(paint);
  });
}
