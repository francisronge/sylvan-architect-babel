import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { orchardSourceCitations } from '../docs/research/relation-orchard/source-citations.ts';
import { orchardResearchImages, orchardSourcePreviewPath } from '../docs/research/relation-orchard/source-research-images.ts';

test('every public Orchard card has an explicit, classified provenance entry', () => {
  const lab = readFileSync(new URL('../docs/design/visual-relations-current-lab.tsx', import.meta.url), 'utf8');
  const archivedBody = lab.match(/export const archivedExampleArchetypes = new Set\(\[([\s\S]*?)\]\);/)?.[1];
  assert.ok(archivedBody, 'archived archetype list must remain discoverable');
  const archived = new Set([...archivedBody.matchAll(/'([^']+)'/g)].map((match) => match[1]));
  const publicCodes = [...lab.matchAll(/archetype:\s*'([^'.]+)\./g)]
    .map((match) => match[1])
    .filter((code) => !archived.has(code));
  assert.equal(new Set(publicCodes).size, publicCodes.length, 'public card codes must be unique');
  assert.deepEqual(Object.keys(orchardSourceCitations).sort(), publicCodes.sort());

  const kinds = new Set(['source figure', 'adapted convention', 'Babel composition', 'source unverified']);
  for (const [code, source] of Object.entries(orchardSourceCitations)) {
    assert.ok(kinds.has(source.kind), `${code}: unknown provenance class`);
    assert.ok(source.citation && source.note, `${code}: provenance needs a name and explanation`);
    if (source.kind === 'source figure' || source.kind === 'adapted convention') {
      assert.ok(source.location && source.url, `${code}: source mapping needs a locator and link`);
    }
    if (source.image) {
      assert.ok(source.url && source.image.licenseUrl, `${code}: image needs source and license links`);
      assert.ok(existsSync(new URL(`../docs/research/relation-orchard/${source.image.path}`, import.meta.url)), `${code}: cited image must be present`);
    }
  }
});

test('research captures map to public Orchard cards and shipped previews', () => {
  const localCache = new URL('../docs/design/visual-relations-assets/', import.meta.url);
  const cachePresent = existsSync(localCache);
  for (const [code, images] of Object.entries(orchardResearchImages)) {
    assert.ok(orchardSourceCitations[code], `${code}: image has no public Orchard card`);
    assert.ok(images.length > 0, `${code}: empty research image list`);
    for (const image of images) {
      assert.ok(image.label, `${code}: image needs a figure label`);
      assert.ok(['cited figure', 'visual precedent'].includes(image.role), `${code}: unknown image role`);
      assert.ok(!image.path.startsWith('/') && !image.path.includes('..'), `${code}: image path must stay in the research cache`);
      assert.ok(existsSync(new URL(`../docs/research/relation-orchard/${orchardSourcePreviewPath(image.path)}`, import.meta.url)), `${code}: public preview is missing for ${image.path}`);
      if (cachePresent) {
        assert.ok(existsSync(new URL(image.path, localCache)), `${code}: missing local research capture ${image.path}`);
      }
    }
  }
});

test('public Orchard shows preview images without a local-host gate', () => {
  const lab = readFileSync(new URL('../docs/design/visual-relations-current-lab.tsx', import.meta.url), 'utf8');
  assert.match(lab, /sourceImageUrl\(orchardSourcePreviewPath\(researchImage\.path\)\)/);
  assert.doesNotMatch(lab, /function localResearchImages\(/);
});

test('corrected visual precedents expose the actual relation', () => {
  const firstImage = (code) => orchardResearchImages[code][0];
  for (const [code, path] of Object.entries({
    C: 'mit-control-raising.png',
    D: 'agree-merge-and-agree.jpg',
    F5: 'meadows-yan-verb-doubling-page-6.png',
    H: 'f37-many-to-many-pf-plate-source.png',
    I1: 'quantifier-raising-wang-example14.png',
    I1b: 'operator-variable-baumann-figure2-32.png',
    L1: 'remnant-wiland-example62.png',
    M1: 'phillips-2006-figure4-subject-island-paths.png',
    O6: 'split-antecedence-pdtc-2026-figure2.png'
  })) {
    assert.ok(firstImage(code).path.endsWith(path), `${code}: first image must show the claimed visual mechanism`);
  }
  assert.equal(firstImage('C').role, 'cited figure');
  assert.equal(firstImage('I1').role, 'cited figure');
  assert.equal(firstImage('D').role, 'visual precedent');
  assert.notEqual(firstImage('D').path, firstImage('D6').path, 'general Agree and case collection need distinct source figures');
  assert.ok(orchardResearchImages.I2[0].path.endsWith('reconstruction-vp-phase.png'));
  assert.match(orchardSourceCitations.C.note, /squared empty-position outlines/);
  assert.match(orchardSourceCitations.H6.note, /four numbered horizontal movement paths/);
  assert.match(orchardSourceCitations.H6.note, /adaptation rather than a literal copy/);
  assert.match(orchardSourceCitations.H6.note, /ORDERING plaque/);
  assert.match(orchardResearchImages.H6[0].path, /fox-pesetsky-cyclic-linearization-example2\.png$/);
  assert.match(orchardSourceCitations.I1.note, /exact QR tree selected in Babel Reborn/);
  assert.match(orchardSourceCitations.I1b.note, /hulls/);
  assert.equal(orchardSourceCitations.O6.kind, 'source unverified');
  assert.match(orchardSourceCitations.O5.note, /no two-row plaque/);
  assert.match(orchardSourceCitations.M1.note, /not a mark present in Figure 4/);
  assert.match(orchardSourceCitations.F.note, /no source shows the exact opacity/);
});

test('identity-source diagrams are conceptual precedents, not credited with Forest light', () => {
  const source = orchardSourceCitations.B;
  assert.equal(source.kind, 'Babel composition');
  assert.match(source.citation, /Forest light.*Francis Ronge/);
  assert.match(source.note, /tree diagrams do not contain Forest light/);
  assert.ok(orchardResearchImages.B.every((image) => image.role === 'visual precedent'));
});
