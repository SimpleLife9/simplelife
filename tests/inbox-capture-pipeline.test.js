import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCaptureRecordDraft,
  INBOX_CATEGORIES,
  validateCapturePartProposals,
} from '../src/features/inbox/domain/capture-pipeline.js';

test('capture draft preserves the original source byte-for-byte at the string boundary', () => {
  const original = '  Comprar café ☕.\nLlamar a Ana.  ';
  const draft = createCaptureRecordDraft({ inputType: 'text', contentOriginal: original });
  assert.deepEqual(draft, { input_type: 'text', content_original: original });
  assert.equal(draft.content_original, original);
  assert.ok(Object.isFrozen(draft));
});

test('capture draft accepts the input types already defined by the database', () => {
  for (const inputType of ['text', 'voice', 'file', 'import']) {
    assert.equal(createCaptureRecordDraft({ inputType, contentOriginal: 'source' }).input_type, inputType);
  }
});

test('capture draft rejects invalid types, non-string content and whitespace-only content', () => {
  assert.throws(() => createCaptureRecordDraft({ inputType: 'audio', contentOriginal: 'voice' }), /input type/);
  assert.throws(() => createCaptureRecordDraft({ inputType: 'text', contentOriginal: 42 }), /string/);
  assert.throws(() => createCaptureRecordDraft({ inputType: 'text', contentOriginal: '  \n  ' }), /blank/);
});

test('a single classification proposal covers the whole capture and stays unreviewed', () => {
  const original = 'Comprar arroz para la casa.';
  const [result] = validateCapturePartProposals(original, [{
    startOffset: 0,
    endOffset: original.length,
    category: 'task',
    confidence: 0.91,
    interpretation: 'Propuesta: crear una tarea.',
    requiresClarification: false,
  }]);

  assert.deepEqual(result, {
    part: {
      part_index: 0,
      original_fragment: original,
      interpretation: 'Propuesta: crear una tarea.',
      category: 'task',
      review_status: 'unreviewed',
    },
    confidence: 0.91,
    requiresClarification: false,
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.part));
});

test('multi-item proposals split without changing or omitting source characters', () => {
  const original = 'Comprar café ☕.  Llamar a Ana.\nLeer el informe.';
  const firstEnd = original.indexOf('Llamar');
  const secondEnd = original.indexOf('Leer');
  const result = validateCapturePartProposals(original, [
    {
      startOffset: 0,
      endOffset: firstEnd,
      category: 'task',
      confidence: 0.88,
      requiresClarification: false,
    },
    {
      startOffset: firstEnd,
      endOffset: secondEnd,
      category: 'request',
      confidence: 0.66,
      interpretation: 'Parece una petición; confirmar el destinatario.',
      requiresClarification: true,
    },
    {
      startOffset: secondEnd,
      endOffset: original.length,
      category: 'note_idea',
      confidence: 0.73,
      requiresClarification: false,
    },
  ]);

  assert.equal(result.map((item) => item.part.original_fragment).join(''), original);
  assert.deepEqual(result.map((item) => item.part.part_index), [0, 1, 2]);
  assert.ok(result.every((item) => item.part.review_status === 'unreviewed'));
  assert.equal(result[1].requiresClarification, true);
});

test('all eight roadmap category groups are accepted as suggestions', () => {
  assert.deepEqual(INBOX_CATEGORIES, [
    'task', 'event', 'request', 'habit', 'goal_subgoal', 'project', 'note_idea', 'list',
  ]);
  for (const category of INBOX_CATEGORIES) {
    const original = 'source';
    const [proposal] = validateCapturePartProposals(original, [{
      startOffset: 0,
      endOffset: original.length,
      category,
      confidence: 0.5,
      requiresClarification: true,
    }]);
    assert.equal(proposal.part.category, category);
    assert.equal(proposal.part.review_status, 'unreviewed');
  }
});

test('proposals reject gaps, overlaps and out-of-order ranges', () => {
  const original = 'one two';
  const make = (startOffset, endOffset) => ({
    startOffset, endOffset, category: 'task', confidence: 0.5, requiresClarification: false,
  });
  assert.throws(() => validateCapturePartProposals(original, [make(0, 3), make(4, 7)]), /contiguous/);
  assert.throws(() => validateCapturePartProposals(original, [make(0, 5), make(4, 7)]), /contiguous/);
  assert.throws(() => validateCapturePartProposals(original, [make(4, 7), make(0, 4)]), /contiguous/);
});

test('proposals reject dropped trailing source characters', () => {
  const original = 'do this.';
  assert.throws(() => validateCapturePartProposals(original, [{
    startOffset: 0,
    endOffset: original.length - 1,
    category: 'task',
    confidence: 0.5,
    requiresClarification: false,
  }]), /cover the full original/);
});

test('proposals reject fabricated fragments and blank split fragments', () => {
  assert.throws(() => validateCapturePartProposals('source', [{
    startOffset: 0, endOffset: 6, originalFragment: 'changed',
    category: 'task', confidence: 0.5, requiresClarification: false,
  }]), /exactly match/);
  assert.throws(() => validateCapturePartProposals('   ', [{
    startOffset: 0, endOffset: 3,
    category: 'task', confidence: 0.5, requiresClarification: false,
  }]), /blank/);
});

test('proposals reject invalid categories, confidence and missing clarification decision', () => {
  const base = {
    startOffset: 0, endOffset: 6, category: 'unknown',
    confidence: 0.5, requiresClarification: false,
  };
  assert.throws(() => validateCapturePartProposals('source', [base]), /category/);
  assert.throws(() => validateCapturePartProposals('source', [{ ...base, category: 'task', confidence: 1.1 }]), /confidence/);
  assert.throws(() => validateCapturePartProposals('source', [{ ...base, category: 'task', confidence: Number.NaN }]), /confidence/);
  assert.throws(() => validateCapturePartProposals('source', [{ ...base, category: 'task', confidence: 0.5, requiresClarification: undefined }]), /clarification/);
});

test('proposals reject unsupported interpretation data', () => {
  assert.throws(() => validateCapturePartProposals('source', [{
    startOffset: 0, endOffset: 6, category: 'task',
    confidence: 0.5, interpretation: { text: 'not plain text' }, requiresClarification: false,
  }]), /plain text/);
});
