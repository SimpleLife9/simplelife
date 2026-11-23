import {
  addRecurrenceCalendarDays,
  applyOccurrenceOverride,
  expandRecurrenceDates,
  validateRecurrenceRule,
} from './recurrence.js';

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function validSeriesId(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 128,
    label + ' must be a non-empty string up to 128 characters.');
  return value;
}

function occurrenceAt(rule, seriesId, date) {
  const items = expandRecurrenceDates({
    rule,
    seriesId,
    rangeStart: date,
    rangeEnd: date,
    maxOccurrences: 1,
  });
  assert(items.length === 1, 'The selected date is not an eligible occurrence of this series.');
  return items[0];
}

/**
 * Plans a versioned series edit without writing data.
 *
 * "This and following" keeps the old recurrence anchor (the date from which
 * DAILY/WEEKLY/MONTHLY/YEARLY interval phase is calculated) while splitting
 * segment visibility at the selected original civil slot. The selected
 * occurrence keeps its original occurrenceKey and is carried into the new
 * segment; generation for that segment resumes strictly after it.
 *
 * Persistence must store effectiveFromDate/effectiveThroughDate separately
 * from the rule anchor, so an interval=2 weekly series does not change phase
 * when it is split on an every-other-week occurrence.
 */
export function planRecurrenceEditScope({
  scope,
  seriesId: inputSeriesId,
  rule: inputRule,
  selectedDate,
  proposedRule: inputProposedRule = null,
  override = null,
  newSeriesId: inputNewSeriesId = null,
  effectiveFromDate: inputEffectiveFromDate = null,
  effectiveThroughDate: inputEffectiveThroughDate = null,
}) {
  const seriesId = validSeriesId(inputSeriesId, 'seriesId');
  const rule = validateRecurrenceRule(inputRule);
  const selectedOccurrence = occurrenceAt(rule, seriesId, selectedDate);
  const segmentStart = inputEffectiveFromDate == null
    ? rule.startDate
    : inputEffectiveFromDate;
  const segmentEnd = inputEffectiveThroughDate == null
    ? rule.until
    : inputEffectiveThroughDate;
  assert(segmentStart >= rule.startDate, 'effectiveFromDate cannot precede the recurrence anchor.');
  assert(selectedDate >= segmentStart, 'selectedDate cannot precede the active series segment.');
  assert(segmentEnd == null || selectedDate <= segmentEnd,
    'selectedDate cannot follow the active series segment.');

  if (scope === 'this_occurrence') {
    assert(inputProposedRule == null && inputNewSeriesId == null,
      'This occurrence scope cannot replace the series rule or create a new series.');
    assert(override && typeof override === 'object', 'This occurrence scope requires an occurrence override.');
    const occurrence = applyOccurrenceOverride(selectedOccurrence, {
      ...override,
      occurrenceKey: selectedOccurrence.occurrenceKey,
    });
    return Object.freeze({
      scope,
      seriesId,
      seriesRuleUnchanged: true,
      occurrence,
      occurrenceKey: selectedOccurrence.occurrenceKey,
    });
  }

  assert(scope === 'this_and_following' || scope === 'entire_series',
    'Edit scope must be this_occurrence, this_and_following or entire_series.');
  assert(override == null, 'Series edit scopes do not accept occurrence overrides.');

  const proposedRule = validateRecurrenceRule(inputProposedRule ?? rule);
  assert(proposedRule.temporalKind === rule.temporalKind,
    'A series edit cannot change temporal kind.');
  if (scope === 'this_and_following') {
    const newSeriesId = validSeriesId(inputNewSeriesId, 'newSeriesId');
    assert(newSeriesId !== seriesId, 'A split requires a new series ID.');
    assert(proposedRule.startDate === rule.startDate,
      'This-and-following edits must preserve the original recurrence anchor to retain interval phase.');
    assert(proposedRule.temporalKind === rule.temporalKind,
      'A split cannot change temporal kind.');
    const previousThrough = addRecurrenceCalendarDays(selectedDate, -1);
    const previousSegment = selectedDate === segmentStart
      ? null
      : Object.freeze({
        seriesId,
        rule,
        effectiveFromDate: segmentStart,
        effectiveThroughDate: previousThrough,
      });
    return Object.freeze({
      scope,
      previousSegment,
      nextSegment: Object.freeze({
        seriesId: newSeriesId,
        rule: proposedRule,
        effectiveFromDate: selectedDate,
        effectiveThroughDate: segmentEnd,
        inheritedOccurrenceKey: selectedOccurrence.occurrenceKey,
        materializeAfterDate: selectedDate,
      }),
      selectedOccurrenceKey: selectedOccurrence.occurrenceKey,
      preserveSelectedOccurrenceIdentity: true,
    });
  }

  // Entire-series edits replace the future rule from the selected civil slot;
  // completed/history rows before the boundary are preserved verbatim.
  assert(proposedRule.startDate === selectedDate,
    'Entire-series edits must anchor the replacement rule at the selected date.');
  const proposedSelected = occurrenceAt(proposedRule, seriesId, selectedDate);
  return Object.freeze({
    scope,
    seriesId,
    historicalRule: rule,
    replacementRule: proposedRule,
    preserveHistoryBeforeDate: selectedDate,
    replaceFutureFromDate: selectedDate,
    selectedOccurrenceKey: selectedOccurrence.occurrenceKey,
    replacementStartsWithOccurrence: proposedSelected.originalLocalDate === selectedDate,
  });
}
