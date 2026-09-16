(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.VertexCurriculum = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COURSE_ID = 'lbusd-accelerated-geometry';
  const makeId = (section, slug) => `${COURSE_ID}:${section}:${slug}`;
  const q = (section, slug, type, prompt, answer, options = [], explanation = '') => ({
    id: makeId(section, slug), type, prompt, answer, options, explanation
  });

  const units = [
    {
      id: 'unit-1', title: 'Unit 1 - Basics of Geometry and Reasoning & Proofs', order: 1,
      chapters: [
        {
          id: 'chapter-1', title: 'Chapter 1 - Basics of Geometry', order: 1,
          sections: [
            {
              id: '1-1', title: '1-1 Points, Lines, and Planes', order: 1, access: 'free',
              summary: 'Use precise geometric notation to identify points, lines, planes, collinear points, coplanar points, and intersections.',
              concepts: ['point', 'line', 'plane', 'collinear', 'coplanar', 'intersection'],
              questions: [
                q('1-1', 'line-two-points', 'mcq', 'Which statement names a line through points A and B?', 'line AB', ['line AB', 'segment AB', 'ray AB', 'plane AB'], 'A line may be named by any two points on it.'),
                q('1-1', 'collinear-definition', 'mcq', 'Points that lie on the same line are called _____.', 'collinear', ['collinear', 'coplanar', 'congruent', 'adjacent'], 'Collinear points lie on one line.'),
                q('1-1', 'planes-intersect', 'mcq', 'When two distinct planes intersect, their intersection is a _____.', 'line', ['point', 'line', 'ray', 'plane'], 'Two intersecting planes meet in a line.'),
                q('1-1', 'coplanar-definition', 'text', 'Complete the definition: Coplanar points lie in the same _____.', 'plane', [], 'Coplanar means lying in the same plane.')
              ]
            },
            {
              id: '1-3', title: '1-3 Midpoint and Distance Formulas', order: 3, access: 'free',
              summary: 'Find midpoints, missing endpoints, and distances in the coordinate plane.',
              concepts: ['Midpoint Formula', 'Distance Formula', 'segment bisector'],
              questions: [
                q('1-3', 'midpoint-1', 'text', 'Find the midpoint of J(-3, 2) and K(9, 2). Enter an ordered pair.', '(3, 2)', [], 'Average the x-coordinates and the y-coordinates.'),
                q('1-3', 'midpoint-2', 'text', 'Find the midpoint of J(1, 3) and K(7, 5). Enter an ordered pair.', '(4, 4)', [], 'M=((1+7)/2, (3+5)/2).'),
                q('1-3', 'missing-endpoint', 'text', 'M(2, 5) is the midpoint of AB and A(2, 3). Find B.', '(2, 7)', [], 'Use B=(2Mx-Ax, 2My-Ay).'),
                q('1-3', 'distance-345', 'text', 'Find the distance between P(1, 3) and Q(5, 6).', '5', [], 'The coordinate differences are 4 and 3, making a 3-4-5 triangle.')
              ]
            },
            {
              id: '1-4', title: '1-4 Perimeter and Area in the Coordinate Plane', order: 4, access: 'premium',
              summary: 'Use coordinate lengths to calculate perimeter and area of polygons.',
              concepts: ['perimeter', 'area', 'coordinate plane'],
              questions: [
                q('1-4', 'rectangle-area', 'text', 'A rectangle has vertices (0,0), (6,0), (6,4), and (0,4). Find its area.', '24', [], 'Area = length x width = 6 x 4.'),
                q('1-4', 'rectangle-perimeter', 'text', 'A rectangle has side lengths 7 and 3. Find its perimeter.', '20', [], 'P=2l+2w.'),
                q('1-4', 'triangle-area', 'text', 'A triangle has base 8 units and height 5 units. Find its area.', '20', [], 'A=1/2 bh.')
              ]
            },
            {
              id: '1-5', title: '1-5 Measuring and Constructing Angles', order: 5, access: 'free',
              summary: 'Name angles and use the Angle Addition Postulate, complements, supplements, and linear pairs.',
              concepts: ['Angle Addition Postulate', 'complementary angles', 'supplementary angles', 'linear pair'],
              questions: [
                q('1-5', 'angle-addition', 'text', 'Ray BD is inside angle ABC. If m∠ABD=28° and m∠DBC=47°, find m∠ABC.', '75', [], 'By the Angle Addition Postulate, 28+47=75.'),
                q('1-5', 'complement', 'text', 'Find the complement of a 34° angle.', '56', [], 'Complementary angles have measures that add to 90°.'),
                q('1-5', 'supplement', 'text', 'Find the supplement of a 113° angle.', '67', [], 'Supplementary angles have measures that add to 180°.'),
                q('1-5', 'linear-pair', 'mcq', 'Which postulate states that angles forming a linear pair are supplementary?', 'Linear Pair Postulate', ['Angle Addition Postulate', 'Linear Pair Postulate', 'Vertical Angle Theorem', 'Segment Addition Postulate'], 'Use the exact class term: Linear Pair Postulate.')
              ]
            },
            {
              id: '1-6', title: '1-6 Angle Relationships', order: 6, access: 'premium',
              summary: 'Solve equations involving vertical angles, complementary angles, supplementary angles, and linear pairs.',
              concepts: ['vertical angles', 'complements', 'supplements', 'linear pairs'],
              questions: [
                q('1-6', 'vertical-equation', 'text', 'Vertical angles measure (3x+8)° and (6x-22)°. Solve for x.', '10', [], 'Vertical angles are congruent, so 3x+8=6x-22.'),
                q('1-6', 'complement-equation', 'text', 'Complementary angles measure (3x+6)° and (4x-14)°. Solve for x.', '14', [], 'Complementary angles sum to 90°.'),
                q('1-6', 'supplement-equation', 'text', 'Supplementary angles measure (6x+59)° and (3x-14)°. Solve for x.', '15', [], 'Supplementary angles sum to 180°.')
              ]
            }
          ]
        },
        {
          id: 'chapter-2', title: 'Chapter 2 - Reasoning and Proofs', order: 2,
          sections: [
            {
              id: '2-2', title: '2-2 Inductive and Deductive Reasoning', order: 2, access: 'free',
              summary: 'Distinguish conjectures built from patterns from conclusions based on accepted facts and logic.',
              concepts: ['inductive reasoning', 'deductive reasoning', 'conjecture', 'counterexample'],
              questions: [
                q('2-2', 'inductive', 'mcq', 'A student studies several examples, notices a pattern, and makes a conjecture. Which type of reasoning is this?', 'inductive reasoning', ['inductive reasoning', 'deductive reasoning', 'Reflexive Property', 'Substitution Property'], 'Inductive reasoning uses observed patterns to form a conjecture.'),
                q('2-2', 'deductive', 'mcq', 'A conclusion follows from definitions, postulates, theorems, and known facts. Which type of reasoning is this?', 'deductive reasoning', ['inductive reasoning', 'deductive reasoning', 'estimation', 'construction'], 'Deductive reasoning applies accepted facts and valid logical steps.'),
                q('2-2', 'counterexample', 'text', 'One example that proves a conjecture false is called a _____.', 'counterexample', [], 'A single counterexample disproves a universal conjecture.')
              ]
            },
            {
              id: '2-4', title: '2-4 Algebraic Reasoning', order: 4, access: 'free',
              summary: 'Justify equation steps with the Properties of Equality and organize reasoning in a two-column proof.',
              concepts: ['Addition Property of Equality', 'Subtraction Property of Equality', 'Multiplication Property of Equality', 'Division Property of Equality', 'Substitution Property of Equality', 'Reflexive Property', 'Symmetric Property', 'Transitive Property', 'Distributive Property', 'Segment Addition Postulate'],
              questions: [
                q('2-4', 'subtract-property', 'mcq', 'From a+12=20 to a=8, which reason justifies the step?', 'Subtraction Property of Equality', ['Addition Property of Equality', 'Subtraction Property of Equality', 'Division Property of Equality', 'Substitution Property of Equality'], 'The same value is subtracted from both sides.'),
                q('2-4', 'divide-property', 'mcq', 'From 8x=40 to x=5, which reason justifies the step?', 'Division Property of Equality', ['Multiplication Property of Equality', 'Division Property of Equality', 'Symmetric Property', 'Distributive Property'], 'Both sides are divided by 8.'),
                q('2-4', 'reflexive', 'mcq', 'Which reason justifies LA=LA in a two-column proof?', 'Reflexive Property', ['Reflexive Property', 'Symmetric Property', 'Transitive Property', 'Given'], 'A quantity equals itself by the Reflexive Property.'),
                q('2-4', 'distribute', 'mcq', 'Which property justifies -10x+6(2-x)=-10x+12-6x?', 'Distributive Property', ['Substitution Property of Equality', 'Distributive Property', 'Transitive Property', 'Segment Addition Postulate'], 'The factor 6 is distributed to both terms.'),
                q('2-4', 'proof-final', 'mcq', 'Given FL=AT and LA=LA, after FL+LA=AT+LA and segment addition rewrites the sums as FA and LT, which reason proves FA=LT?', 'Substitution Property of Equality', ['Given', 'Substitution Property of Equality', 'Reflexive Property', 'Angle Addition Postulate'], 'Substitute FA and LT for their equal segment sums.')
              ]
            },
            {
              id: '2-5', title: '2-5 Proving Statements about Segments and Angles', order: 5, access: 'premium',
              summary: 'Connect equality and congruence while building two-column proofs about segment and angle bisectors.',
              concepts: ['Reflexive Property of Congruence', 'Symmetric Property of Congruence', 'Transitive Property of Congruence', 'Definition of Congruent Segments', 'Definition of Congruent Angles', 'Definition of angle bisector', 'Angle Addition Postulate'],
              questions: [
                q('2-5', 'congruent-definition', 'mcq', 'If segment AB is congruent to segment CD, which statement follows by the Definition of Congruent Segments?', 'AB=CD', ['AB=CD', 'AB+CD=180', 'AB is perpendicular to CD', 'A=C'], 'Congruent segments have equal lengths.'),
                q('2-5', 'bisector', 'mcq', 'Given ray MP bisects ∠LMN, which statement follows from the Definition of angle bisector?', '∠LMP ≅ ∠NMP', ['∠LMP ≅ ∠NMP', '∠LMP and ∠NMP are supplementary', 'MP=MN', '∠LMN is a right angle'], 'An angle bisector divides an angle into two congruent angles.'),
                q('2-5', 'congruent-to-equal', 'mcq', 'From ∠LMP ≅ ∠NMP, what statement follows by the Definition of Congruent Angles?', 'm∠LMP=m∠NMP', ['m∠LMP=m∠NMP', 'm∠LMP+m∠NMP=90', 'LM=MN', 'MP bisects LN'], 'Congruent angles have equal measures.'),
                q('2-5', 'proof-substitution', 'mcq', 'In the angle-bisector proof, replace m∠NMP with m∠LMP in m∠LMP+m∠NMP=m∠LMN. What is the reason?', 'Substitution Property of Equality', ['Angle Addition Postulate', 'Substitution Property of Equality', 'Given', 'Symmetric Property'], 'Equal measures may be substituted.'),
                q('2-5', 'proof-distributive', 'mcq', 'Which property rewrites m∠LMP+m∠LMP as 2(m∠LMP)?', 'Distributive Property', ['Transitive Property', 'Distributive Property', 'Definition of Congruent Angles', 'Linear Pair Postulate'], 'Factor the repeated measure using the Distributive Property.')
              ]
            },
            {
              id: '2-6', title: '2-6 Proving Geometric Relationships', order: 6, access: 'premium',
              summary: 'Use named theorems and postulates to prove relationships among vertical angles, linear pairs, complements, and supplements.',
              concepts: ['Linear Pair Postulate', 'Vertical Angle Theorem', 'Congruent Supplements Theorem', 'Congruent Complements Theorem', 'Transitive Property of Congruence'],
              questions: [
                q('2-6', 'vertical-theorem', 'mcq', 'Which theorem states that vertical angles are congruent?', 'Vertical Angle Theorem', ['Linear Pair Postulate', 'Vertical Angle Theorem', 'Congruent Supplements Theorem', 'Angle Addition Postulate'], 'Use the exact class term: Vertical Angle Theorem.'),
                q('2-6', 'linear-pair-postulate', 'mcq', 'If two angles form a linear pair, what reason proves they are supplementary?', 'Linear Pair Postulate', ['Linear Pair Postulate', 'Vertical Angle Theorem', 'Definition of Congruent Angles', 'Reflexive Property'], 'A linear pair is supplementary by the Linear Pair Postulate.'),
                q('2-6', 'congruent-supplements', 'mcq', 'Two angles are supplementary to the same angle. Which theorem can prove them congruent?', 'Congruent Supplements Theorem', ['Congruent Complements Theorem', 'Congruent Supplements Theorem', 'Vertical Angle Theorem', 'Segment Addition Postulate'], 'Angles supplementary to the same angle are congruent.'),
                q('2-6', 'congruent-complements', 'mcq', 'Two angles are complementary to congruent angles. Which theorem can prove them congruent?', 'Congruent Complements Theorem', ['Congruent Complements Theorem', 'Congruent Supplements Theorem', 'Linear Pair Postulate', 'Transitive Property of Equality'], 'Angles complementary to congruent angles are congruent.'),
                q('2-6', 'transitive-proof', 'mcq', 'Given ∠2≅∠3, ∠1≅∠3, and ∠3≅∠4, what property supports the final congruence connection?', 'Transitive Property of Congruence', ['Reflexive Property of Congruence', 'Transitive Property of Congruence', 'Distributive Property', 'Angle Addition Postulate'], 'The Transitive Property of Congruence connects angles congruent through a common angle.')
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'unit-2', title: 'Unit 2 - Parallel and Perpendicular Lines', order: 2,
      chapters: [
        {
          id: 'chapter-3', title: 'Chapter 3 - Parallel and Perpendicular Lines', order: 3,
          sections: [
            {
              id: '3-1', title: '3-1 Pairs of Lines and Angles', order: 1, access: 'premium',
              summary: 'Identify parallel, perpendicular, and skew lines and angle pairs formed by a transversal.',
              concepts: ['parallel lines', 'perpendicular lines', 'skew lines', 'transversal', 'corresponding angles', 'alternate interior angles', 'alternate exterior angles', 'same-side interior angles'],
              questions: [
                q('3-1', 'perpendicular', 'mcq', 'Two lines that intersect to form right angles are _____.', 'perpendicular', ['parallel', 'perpendicular', 'skew', 'coplanar'], 'Perpendicular lines form right angles.'),
                q('3-1', 'skew', 'mcq', 'Noncoplanar lines that do not intersect are _____.', 'skew', ['parallel', 'perpendicular', 'skew', 'transversals'], 'Skew lines are noncoplanar and do not intersect.'),
                q('3-1', 'transversal', 'text', 'A line that intersects two or more coplanar lines at different points is a _____.', 'transversal', [], 'This is the definition of a transversal.'),
                q('3-1', 'alternate-interior', 'mcq', 'Angles between two lines and on opposite sides of a transversal are called _____.', 'alternate interior angles', ['corresponding angles', 'alternate interior angles', 'vertical angles', 'same-side exterior angles'], 'Alternate interior angles lie inside the two lines on opposite sides of the transversal.')
              ]
            }
          ]
        }
      ]
    }
  ];

  const sourceManifest = {
    schemaVersion: 1,
    courseId: COURSE_ID,
    identity: 'courseId + Canvas section number; sources merge into the existing section instead of creating another module',
    syncPolicy: 'Match sectionId first, then sourceId. Replace changed sourceHash content, preserve unchanged sections, and append only genuinely new stable IDs.',
    sources: [
      { sourceId: 'canvas:1-1', sectionId: '1-1', kind: 'canvas-published', title: '1-1 Points, Lines, and Planes' },
      { sourceId: 'canvas:1-3', sectionId: '1-3', kind: 'canvas-published', title: '1-3 Midpoint and Distance Formulas' },
      { sourceId: 'canvas:1-4', sectionId: '1-4', kind: 'canvas-published', title: '1-4 Perimeter and Area in the Coordinate Plane' },
      { sourceId: 'canvas:1-5', sectionId: '1-5', kind: 'canvas-published', title: '1-5 Measuring and Constructing Angles' },
      { sourceId: 'canvas:1-6', sectionId: '1-6', kind: 'canvas-published', title: '1-6 Angle Relationships' },
      { sourceId: 'canvas:2-2', sectionId: '2-2', kind: 'canvas-published', title: '2-2 Inductive and Deductive Reasoning' },
      { sourceId: 'canvas:2-4', sectionId: '2-4', kind: 'canvas-published', title: '2-4 Algebraic Reasoning' },
      { sourceId: 'pdf:section-2-4-annotated', sectionId: '2-4', kind: 'teacher-pdf', title: 'Section 2-4 - Algebraic Reasoning - annotated' },
      { sourceId: 'canvas:2-5', sectionId: '2-5', kind: 'canvas-published', title: '2-5 Proving Statements about Segments and Angles' },
      { sourceId: 'pdf:section-2-5-annotated', sectionId: '2-5', kind: 'teacher-pdf', title: 'Section 2-5 - Proving Statements about Segments and Angles - annotated' },
      { sourceId: 'canvas:2-6', sectionId: '2-6', kind: 'canvas-published', title: '2-6 Proving Geometric Relationships' },
      { sourceId: 'pdf:section-2-6-annotated', sectionId: '2-6', kind: 'teacher-pdf', title: 'Section 2-6 - Proving Geometric Relationships - annotated' },
      { sourceId: 'canvas:3-1', sectionId: '3-1', kind: 'canvas-published', title: '3-1 Pairs of Lines and Angles' },
      { sourceId: 'pdf:accelerated-geometry-sequence', sectionId: 'course-sequence', kind: 'teacher-pdf', title: 'Accelerated Geometry Sequence' },
      { sourceId: 'pdf:chapter-1-review-answers', sectionId: 'chapter-1-review', kind: 'teacher-pdf', title: 'Review for Test #1 - ANSWERS' }
    ]
  };

  function flattenSections() {
    return units.flatMap(unit => unit.chapters.flatMap(chapter => chapter.sections.map(section => ({ ...section, unitId: unit.id, unitTitle: unit.title, chapterId: chapter.id, chapterTitle: chapter.title }))));
  }

  function validateCurriculum() {
    const sections = flattenSections();
    const sectionIds = sections.map(section => section.id);
    const questionIds = sections.flatMap(section => section.questions.map(question => question.id));
    return {
      sectionCount: sections.length,
      questionCount: questionIds.length,
      duplicateSectionIds: sectionIds.filter((id, index) => sectionIds.indexOf(id) !== index),
      duplicateQuestionIds: questionIds.filter((id, index) => questionIds.indexOf(id) !== index),
      orphanSources: sourceManifest.sources.filter(source => !['course-sequence', 'chapter-1-review'].includes(source.sectionId) && !sectionIds.includes(source.sectionId))
    };
  }

  function mergeSourceManifest(existingSources, incomingSources) {
    const byId = new Map((existingSources || []).map(source => [source.sourceId, { ...source }]));
    for (const source of incomingSources || []) {
      if (!source?.sourceId || !source?.sectionId) continue;
      byId.set(source.sourceId, { ...(byId.get(source.sourceId) || {}), ...source });
    }
    return [...byId.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  }

  return { schemaVersion: 1, courseId: COURSE_ID, units, sourceManifest, flattenSections, validateCurriculum, mergeSourceManifest };
});
