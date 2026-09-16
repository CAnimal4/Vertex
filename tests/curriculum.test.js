const test = require('node:test');
const assert = require('node:assert/strict');
const curriculum = require('../curriculum.js');
const vertexSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');

const expectedSections = ['1-1', '1-3', '1-4', '1-5', '1-6', '2-2', '2-4', '2-5', '2-6', '3-1'];

test('contains every currently published Canvas section exactly once', () => {
  const sections = curriculum.flattenSections();
  assert.deepEqual(sections.map(section => section.id), expectedSections);
  assert.equal(new Set(sections.map(section => section.id)).size, expectedSections.length);
});

test('stable curriculum and question IDs are unique', () => {
  const validation = curriculum.validateCurriculum();
  assert.equal(validation.sectionCount, 10);
  assert.ok(validation.questionCount >= 35);
  assert.deepEqual(validation.duplicateSectionIds, []);
  assert.deepEqual(validation.duplicateQuestionIds, []);
  assert.deepEqual(validation.orphanSources, []);
  for (const section of curriculum.flattenSections()) {
    for (const question of section.questions) {
      assert.match(question.id, /^lbusd-accelerated-geometry:\d-\d:[a-z0-9-]+$/);
    }
  }
});

test('preserves teacher proof terminology', () => {
  const text = JSON.stringify(curriculum.units);
  for (const term of [
    'Addition Property of Equality', 'Subtraction Property of Equality',
    'Multiplication Property of Equality', 'Division Property of Equality',
    'Substitution Property of Equality', 'Reflexive Property', 'Symmetric Property',
    'Transitive Property', 'Distributive Property', 'Segment Addition Postulate',
    'Angle Addition Postulate', 'Definition of Congruent Angles',
    'Definition of Congruent Segments', 'Linear Pair Postulate',
    'Vertical Angle Theorem', 'Congruent Supplements Theorem',
    'Congruent Complements Theorem'
  ]) assert.ok(text.includes(term), `missing terminology: ${term}`);
});

test('free tier is useful and premium tier remains broader', () => {
  const sections = curriculum.flattenSections();
  const free = sections.filter(section => section.access === 'free');
  const premium = sections.filter(section => section.access === 'premium');
  assert.ok(free.length >= 4);
  assert.ok(free.reduce((sum, section) => sum + section.questions.length, 0) >= 15);
  assert.ok(premium.length >= 4);
});

test('Vertex uses its own feedback and premium request forms', () => {
  assert.match(vertexSource, /feedbackUrl:\s*'https:\/\/tally\.so\/r\/gDEWa1'/);
  assert.match(vertexSource, /premiumUrl:\s*'https:\/\/tally\.so\/r\/44MPBB'/);
  assert.doesNotMatch(vertexSource, /tally\.so\/r\/(?:Pdq7AQ|Y5A1Oq)/);
});

test('source merge is idempotent and updates by stable source ID', () => {
  const initial = [{ sourceId: 'canvas:2-5', sectionId: '2-5', sourceHash: 'old' }];
  const incoming = [
    { sourceId: 'canvas:2-5', sectionId: '2-5', sourceHash: 'new' },
    { sourceId: 'pdf:section-2-5', sectionId: '2-5', sourceHash: 'pdf-a' }
  ];
  const once = curriculum.mergeSourceManifest(initial, incoming);
  const twice = curriculum.mergeSourceManifest(once, incoming);
  assert.deepEqual(twice, once);
  assert.equal(once.length, 2);
  assert.equal(once.find(source => source.sourceId === 'canvas:2-5').sourceHash, 'new');
});
