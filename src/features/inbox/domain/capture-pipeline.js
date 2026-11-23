export const INBOX_CATEGORIES = Object.freeze([
  'task',
  'event',
  'request',
  'habit',
  'goal_subgoal',
  'project',
  'note_idea',
  'list',
]);

const CAPTURE_INPUT_TYPES = new Set(['text', 'voice', 'file', 'import']);
const CATEGORY_SET = new Set(INBOX_CATEGORIES);

function assert(condition, message) {
  if (!condition) throw new RangeError(message);
}

function assertObject(value, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    label + ' must be an object.');
}

/**
 * Builds the persistence payload without normalizing or rewriting the source.
 * The database owns timestamps and the authenticated writer derives owner IDs.
 */
export function createCaptureRecordDraft({ inputType, contentOriginal } = {}) {
  assert(CAPTURE_INPUT_TYPES.has(inputType), 'Unsupported capture input type.');
  assert(typeof contentOriginal === 'string', 'Original capture content must be a string.');
  assert(contentOriginal.trim().length > 0, 'Original capture content cannot be blank.');

  return Object.freeze({
    input_type: inputType,
    content_original: contentOriginal,
  });
}

/**
 * Validates an untrusted classification/splitting result.
 *
 * Offsets are JavaScript UTF-16 code-unit offsets. Fragments are reconstructed
 * from the original source; a caller-supplied fragment is accepted only when
 * it matches the exact source slice. Every character, including separators,
 * must belong to exactly one part.
 *
 * These are proposals only. Every returned part remains unreviewed and no
 * destination link or destination write is created by this function.
 */
export function validateCapturePartProposals(contentOriginal, proposals) {
  assert(typeof contentOriginal === 'string' && contentOriginal.trim().length > 0,
    'Original capture content cannot be blank.');
  assert(Array.isArray(proposals) && proposals.length > 0,
    'At least one capture-part proposal is required.');

  let cursor = 0;

  const validated = proposals.map((proposal, index) => {
    assertObject(proposal, 'Capture-part proposal');
    const { startOffset, endOffset, category, confidence, interpretation, requiresClarification } = proposal;

    assert(Number.isSafeInteger(startOffset) && Number.isSafeInteger(endOffset),
      'Capture-part offsets must be safe integers.');
    assert(startOffset === cursor,
      'Capture-part proposals must be contiguous, ordered and non-overlapping.');
    assert(endOffset > startOffset && endOffset <= contentOriginal.length,
      'Capture-part endOffset must follow startOffset and stay inside the original capture.');

    const originalFragment = contentOriginal.slice(startOffset, endOffset);
    assert(originalFragment.trim().length > 0,
      'Capture parts cannot consist only of whitespace.');
    if (proposal.originalFragment !== undefined) {
      assert(proposal.originalFragment === originalFragment,
        'Capture-part fragment must exactly match the original source range.');
    }

    assert(CATEGORY_SET.has(category), 'Capture-part category is not supported.');
    assert(typeof confidence === 'number' && Number.isFinite(confidence)
      && confidence >= 0 && confidence <= 1,
    'Capture-part confidence must be a finite number between 0 and 1.');
    assert(typeof requiresClarification === 'boolean',
      'Capture-part proposal must explicitly state whether clarification is required.');
    assert(interpretation == null || typeof interpretation === 'string',
      'Capture-part interpretation must be plain text.');

    cursor = endOffset;

    return Object.freeze({
      part: Object.freeze({
        part_index: index,
        original_fragment: originalFragment,
        interpretation: interpretation ?? null,
        category,
        review_status: 'unreviewed',
      }),
      confidence,
      requiresClarification,
    });
  });

  assert(cursor === contentOriginal.length,
    'Capture-part proposals must cover the full original capture without dropping characters.');

  return Object.freeze(validated);
}
