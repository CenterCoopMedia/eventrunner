'use strict';

/** Staff fields need tooltip copy or a documented, self-explanatory label. */
module.exports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { missing: 'Add help tooltip text, or data-help-skip with the reason this label needs no explanation.' },
  },
  create(context) {
    const source = context.sourceCode;
    const fields = new Set(['input', 'select', 'textarea', 'RichTextEditor', 'ImagePicker', 'PlannerSwitch', 'ReminderScheduleSwitch', 'Checkbox', 'Radio']);
    const operatorFunctions = new Set(['PitchEmailSettings', 'ConnectionSettings']);
    function supplied(attribute) {
      if (!attribute?.value) return false;
      const value = attribute.value.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value;
      if (value.type === 'Literal') return typeof value.value === 'string' && value.value.trim().length > 0;
      return !['JSXEmptyExpression'].includes(value.type) && !(value.type === 'Identifier' && value.name === 'undefined');
    }
    return {
      JSXOpeningElement(node) {
        const name = node.name.name;
        if (!fields.has(name) && !/Field$/.test(name || '')) return;
        const ancestors = source.getAncestors(node);
        if (ancestors.some(parent => parent.type === 'FunctionDeclaration' && operatorFunctions.has(parent.id?.name))) return;
        // Mixed staff/operator pages keep operator-only controls out of this audit.
        if (ancestors.some(parent => {
          if (parent.type === 'ConditionalExpression' && source.getText(parent.test) === 'isOperator') {
            return node.range[0] >= parent.consequent.range[0] && node.range[1] <= parent.consequent.range[1];
          }
          return false;
        })) return;
        const attrs = new Map(node.attributes.filter(a => a.type === 'JSXAttribute').map(a => [a.name.name, a]));
        if (name === 'input' && attrs.get('type')?.value?.value === 'hidden') return;
        if (supplied(attrs.get('help')) || supplied(attrs.get('data-help-skip'))) return;
        context.report({ node, messageId: 'missing' });
      },
    };
  },
};
