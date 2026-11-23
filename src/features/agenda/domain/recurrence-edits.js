import { parseCalendarDate } from './temporal.js';
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
 * "This and following" starts a new segment on the selected original civil
 * date. The selected occurrence keeps its original occurrenceKey and is
 * carried into the new segment; subsequent occurrences use the new segment's
 * rule and identity. The previous segment ends the day before the selection.
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
  const selectedDateKey = parseCalendarDate(selectedDate).key;
  const selectedOccurrence = occurrenceAt(rule, seriesId, selectedDateKey);
  const segmentStart = inputEffectiveFromDate == null
    ? rule.startDate
    : parseCalendarDate(inputEffectiveFromDate).key;
  const segmentEnd = inputEffectiveThroughDate == null
    ? null
    : parseCalendarDate(inputEffectiveThroughDate).key;
  assert(segmentStart >= rule.startDate, 'effectiveFromDate cannot precede the recurrence anchor.');
  assert(selectedDateKey >= segmentStart, 'selectedDate cannot precede the active series segment.');
  assert(segmentEnd == null || selectedDateKey <= segmentEnd,
    'selectedDate cannot follow the active series segment.');

  if (scope === 'this_occurrence') {
    assert(inputProposedRule == null && inputNewSeriesId == null,
      'This occurrence scope cannot replace the series rule or create a new series.');
    assert(override && typeof override === 'object', 'This occurrence scope requires an occurrence override.');
    assert(override.occurrenceKey == null || override.occurrenceKey === selectedOccurrence.occurrenceKey,
      'Override occurrenceKey does not match the selected original slot.');
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
    assert(proposedRule.temporalKind === rule.temporalKind,
      'A split cannot change temporal kind.');
    assert(proposedRule.startDate === selectedDateKey,
      'This-and-following edits must start the new segment on the selected original date.');
    const previousThrough = addRecurrenceCalendarDays(selectedDateKey, -1);
    const previousSegment = selectedDateKey === segmentStart
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
        effectiveFromDate: selectedDateKey,
        effectiveThroughDate: segmentEnd,
        inheritedOccurrenceKey: selectedOccurrence.occurrenceKey,
        materializeAfterDate: selectedDateKey,
      }),
      selectedOccurrenceKey: selectedOccurrence.occurrenceKey,
      preserveSelectedOccurrenceIdentity: true,
    });
  }

  // Entire-series edits replace the future rule from the selected civil slot;
  // completed/history rows before the boundary are preserved verbatim.
  assert(proposedRule.startDate === selectedDateKey,
    'Entire-series edits must anchor the replacement rule at the selected date.');
  const proposedSelected = occurrenceAt(proposedRule, seriesId, selectedDateKey);
  return Object.freeze({
    scope,
    seriesId,
    historicalRule: rule,
    replacementRule: proposedRule,
    preserveHistoryBeforeDate: selectedDateKey,
    replaceFutureFromDate: selectedDateKey,
    selectedOccurrenceKey: selectedOccurrence.occurrenceKey,
    replacementStartsWithOccurrence: proposedSelected.originalLocalDate === selectedDateKey,
  });
}
