// Catalog of all shape modifiers with German labels.
//
// A modifier entry is [targetBase, minSuffix, maxSuffix, label]:
//   - two-sided:  value in [-1, 1]; negative drives `${base}-${min}`, positive `${base}-${max}`
//   - one-sided:  min/max null; value in [0, 1] drives `${base}`
// `{s}` in a base expands to the side prefix ('l' / 'r'); those become paired sliders
// that follow the symmetry switch.

export const MODIFIER_GROUPS = [
  {
    id: 'head', label: 'Kopfform', dir: 'head', items: [
      ['head-oval', null, null, 'Oval'],
      ['head-round', null, null, 'Rund'],
      ['head-rectangular', null, null, 'Rechteckig'],
      ['head-square', null, null, 'Quadratisch'],
      ['head-triangular', null, null, 'Dreieckig'],
      ['head-invertedtriangular', null, null, 'Umgekehrt dreieckig'],
      ['head-diamond', null, null, 'Rautenförmig'],
      ['head-age', 'decr', 'incr', 'Kopf-Alter'],
      ['head-angle', 'in', 'out', 'Kopfneigung'],
      ['head-fat', 'decr', 'incr', 'Kopf-Fülle'],
      ['head-scale-depth', 'decr', 'incr', 'Kopftiefe'],
      ['head-scale-horiz', 'decr', 'incr', 'Kopfbreite'],
      ['head-scale-vert', 'decr', 'incr', 'Kopfhöhe'],
      ['head-back-scale-depth', 'decr', 'incr', 'Hinterkopf'],
      ['head-trans', 'in', 'out', 'Position seitlich'],
      ['head-trans', 'down', 'up', 'Position vertikal'],
      ['head-trans', 'backward', 'forward', 'Position vor/zurück'],
    ],
  },
  {
    id: 'forehead', label: 'Stirn', dir: 'forehead', items: [
      ['forehead-trans', 'backward', 'forward', 'Stirn vor/zurück'],
      ['forehead-scale-vert', 'decr', 'incr', 'Stirnhöhe'],
      ['forehead-nubian', 'decr', 'incr', 'Stirnwölbung'],
      ['forehead-temple', 'decr', 'incr', 'Schläfen'],
    ],
  },
  {
    id: 'eyebrows', label: 'Brauenbogen', dir: 'eyebrows', items: [
      ['eyebrows-trans', 'backward', 'forward', 'Brauenwulst'],
      ['eyebrows-angle', 'down', 'up', 'Brauenwinkel'],
      ['eyebrows-trans', 'down', 'up', 'Brauenhöhe'],
    ],
  },
  {
    id: 'eyes', label: 'Augen', dir: 'eyes', items: [
      ['{s}-eye-scale', 'decr', 'incr', 'Augengröße'],
      ['{s}-eye-trans', 'in', 'out', 'Augenabstand'],
      ['{s}-eye-trans', 'down', 'up', 'Augenhöhe'],
      ['{s}-eye-push1', 'in', 'out', 'Augenlid oben tief/vor'],
      ['{s}-eye-push2', 'in', 'out', 'Augenlid unten tief/vor'],
      ['{s}-eye-height1', 'decr', 'incr', 'Öffnung oben innen'],
      ['{s}-eye-height2', 'decr', 'incr', 'Öffnung oben Mitte'],
      ['{s}-eye-height3', 'decr', 'incr', 'Öffnung oben außen'],
      ['{s}-eye-corner1', 'down', 'up', 'Innerer Augenwinkel'],
      ['{s}-eye-corner2', 'down', 'up', 'Äußerer Augenwinkel'],
      ['{s}-eye-epicanthus', 'in', 'out', 'Epikanthus (Lidfalte innen)'],
      ['{s}-eye-eyefold', 'concave', 'convex', 'Lidfalte Wölbung'],
      ['{s}-eye-eyefold', 'down', 'up', 'Lidfalte Höhe'],
      ['{s}-eye-eyefold-angle', 'down', 'up', 'Lidfalte Winkel'],
      ['{s}-eye-bag', 'decr', 'incr', 'Tränensäcke'],
      ['{s}-eye-bag', 'in', 'out', 'Tränensäcke vor/zurück'],
      ['{s}-eye-bag-height', 'decr', 'incr', 'Tränensäcke Höhe'],
    ],
  },
  {
    id: 'nose', label: 'Nase', dir: 'nose', items: [
      ['nose-scale-vert', 'decr', 'incr', 'Nasenlänge'],
      ['nose-scale-horiz', 'decr', 'incr', 'Nasenbreite'],
      ['nose-scale-depth', 'decr', 'incr', 'Nasentiefe'],
      ['nose-trans', 'down', 'up', 'Position vertikal'],
      ['nose-trans', 'backward', 'forward', 'Position vor/zurück'],
      ['nose-trans', 'in', 'out', 'Position seitlich'],
      ['nose-width1', 'decr', 'incr', 'Breite Nasenwurzel'],
      ['nose-width2', 'decr', 'incr', 'Breite Nasenrücken'],
      ['nose-width3', 'decr', 'incr', 'Breite Nasenspitze'],
      ['nose-hump', 'decr', 'incr', 'Höcker'],
      ['nose-curve', 'concave', 'convex', 'Nasenrücken-Kurve'],
      ['nose-greek', 'decr', 'incr', 'Griechische Nase'],
      ['nose-point-width', 'decr', 'incr', 'Spitze Breite'],
      ['nose-point', 'down', 'up', 'Spitze hoch/runter'],
      ['nose-volume', 'decr', 'incr', 'Volumen'],
      ['nose-nostrils-width', 'decr', 'incr', 'Nasenflügel Breite'],
      ['nose-nostrils-angle', 'down', 'up', 'Nasenlöcher Winkel'],
      ['nose-flaring', 'decr', 'incr', 'Nasenflügel gebläht'],
      ['nose-septumangle', 'decr', 'incr', 'Septum-Winkel'],
      ['nose-base', 'down', 'up', 'Nasenbasis'],
      ['nose-compression', 'compress', 'uncompress', 'Kompression'],
    ],
  },
  {
    id: 'mouth', label: 'Mund', dir: 'mouth', items: [
      ['mouth-scale-horiz', 'decr', 'incr', 'Mundbreite'],
      ['mouth-scale-vert', 'decr', 'incr', 'Mundhöhe'],
      ['mouth-scale-depth', 'decr', 'incr', 'Mundtiefe'],
      ['mouth-trans', 'down', 'up', 'Position vertikal'],
      ['mouth-trans', 'backward', 'forward', 'Position vor/zurück'],
      ['mouth-trans', 'in', 'out', 'Position seitlich'],
      ['mouth-upperlip-volume', 'decr', 'incr', 'Oberlippe Volumen'],
      ['mouth-upperlip-height', 'decr', 'incr', 'Oberlippe Höhe'],
      ['mouth-upperlip-width', 'decr', 'incr', 'Oberlippe Breite'],
      ['mouth-upperlip-middle', 'down', 'up', 'Oberlippe Mitte'],
      ['mouth-upperlip-ext', 'down', 'up', 'Oberlippe außen'],
      ['mouth-lowerlip-volume', 'decr', 'incr', 'Unterlippe Volumen'],
      ['mouth-lowerlip-height', 'decr', 'incr', 'Unterlippe Höhe'],
      ['mouth-lowerlip-width', 'decr', 'incr', 'Unterlippe Breite'],
      ['mouth-lowerlip-middle', 'down', 'up', 'Unterlippe Mitte'],
      ['mouth-lowerlip-ext', 'down', 'up', 'Unterlippe außen'],
      ['mouth-cupidsbow', 'decr', 'incr', 'Amorbogen'],
      ['mouth-cupidsbow-width', 'decr', 'incr', 'Amorbogen Breite'],
      ['mouth-philtrum-volume', 'decr', 'incr', 'Philtrum'],
      ['mouth-angles', 'down', 'up', 'Mundwinkel'],
      ['mouth-dimples', 'in', 'out', 'Grübchen'],
      ['mouth-laugh-lines', 'in', 'out', 'Lachfalten'],
    ],
  },
  {
    id: 'ears', label: 'Ohren', dir: 'ears', items: [
      ['{s}-ear-scale', 'decr', 'incr', 'Ohrgröße'],
      ['{s}-ear-scale-vert', 'decr', 'incr', 'Ohrhöhe'],
      ['{s}-ear-scale-depth', 'decr', 'incr', 'Ohrtiefe'],
      ['{s}-ear-trans', 'down', 'up', 'Position vertikal'],
      ['{s}-ear-trans', 'backward', 'forward', 'Position vor/zurück'],
      ['{s}-ear-rot', 'backward', 'forward', 'Rotation'],
      ['{s}-ear-wing', 'decr', 'incr', 'Abstehende Ohren'],
      ['{s}-ear-flap', 'decr', 'incr', 'Ohrmuschel'],
      ['{s}-ear-lobe', 'decr', 'incr', 'Ohrläppchen'],
      ['{s}-ear-shape', 'pointed', 'triangle', 'Spitz ↔ Dreieckig'],
      ['{s}-ear-shape', 'square', 'round', 'Eckig ↔ Rund'],
    ],
  },
  {
    id: 'chin', label: 'Kinn & Kiefer', dir: 'chin', items: [
      ['chin-prominent', 'decr', 'incr', 'Kinn hervortretend'],
      ['chin-width', 'decr', 'incr', 'Kinnbreite'],
      ['chin-height', 'decr', 'incr', 'Kinnhöhe'],
      ['chin-cleft', 'decr', 'incr', 'Kinngrübchen'],
      ['chin-bones', 'decr', 'incr', 'Kieferknochen'],
      ['chin-jaw-drop', 'decr', 'incr', 'Kieferlinie'],
      ['chin-prognathism', 'decr', 'incr', 'Vorbiss (Prognathie)'],
      ['chin-triangle', null, null, 'Spitzes Kinn'],
    ],
  },
  {
    id: 'cheek', label: 'Wangen', dir: 'cheek', items: [
      ['{s}-cheek-bones', 'decr', 'incr', 'Wangenknochen'],
      ['{s}-cheek-volume', 'decr', 'incr', 'Wangenvolumen'],
      ['{s}-cheek-inner', 'decr', 'incr', 'Innere Wange'],
      ['{s}-cheek-trans', 'down', 'up', 'Wangenhöhe'],
    ],
  },
  {
    id: 'neck', label: 'Hals', dir: 'neck', items: [
      ['neck-scale-vert', 'decr', 'incr', 'Halslänge'],
      ['neck-scale-horiz', 'decr', 'incr', 'Halsbreite'],
      ['neck-scale-depth', 'decr', 'incr', 'Halstiefe'],
      ['neck-back-scale-depth', 'decr', 'incr', 'Nacken'],
      ['neck-double', 'decr', 'incr', 'Doppelkinn'],
      ['neck-trans', 'in', 'out', 'Position seitlich'],
      ['neck-trans', 'down', 'up', 'Position vertikal'],
      ['neck-trans', 'backward', 'forward', 'Position vor/zurück'],
    ],
  },
  {
    id: 'torso', label: 'Oberkörper', dir: 'torso', items: [
      ['torso-scale-horiz', 'decr', 'incr', 'Breite'],
      ['torso-scale-depth', 'decr', 'incr', 'Tiefe'],
      ['torso-scale-vert', 'decr', 'incr', 'Länge'],
      ['torso-vshape', 'decr', 'incr', 'V-Form'],
      ['torso-muscle-pectoral', 'decr', 'incr', 'Brustmuskel'],
      ['torso-muscle-dorsi', 'decr', 'incr', 'Rückenmuskel (Latissimus)'],
      ['torso-trans', 'in', 'out', 'Position seitlich'],
      ['torso-trans', 'down', 'up', 'Position vertikal'],
      ['torso-trans', 'backward', 'forward', 'Position vor/zurück'],
    ],
  },
  {
    id: 'breast', label: 'Brust', dir: 'breast', items: [
      ['breast-dist', 'decr', 'incr', 'Abstand'],
      ['breast-point', 'decr', 'incr', 'Spitz zulaufend'],
      ['breast-trans', 'down', 'up', 'Höhe'],
      ['breast-volume-vert', 'down', 'up', 'Volumenverteilung'],
      ['nipple-size', 'decr', 'incr', 'Brustwarzengröße'],
      ['nipple-point', 'decr', 'incr', 'Brustwarzen hervortretend'],
    ],
  },
  {
    id: 'stomach', label: 'Bauch', dir: 'stomach', items: [
      ['stomach-tone', 'decr', 'incr', 'Bauchspannung'],
      ['stomach-pregnant', 'decr', 'incr', 'Schwangerschaft'],
      ['stomach-navel', 'in', 'out', 'Bauchnabel innen/außen'],
      ['stomach-navel', 'down', 'up', 'Bauchnabel Höhe'],
    ],
  },
  {
    id: 'hip', label: 'Hüfte & Becken', dir: 'hip', items: [
      ['hip-scale-horiz', 'decr', 'incr', 'Hüftbreite'],
      ['hip-scale-depth', 'decr', 'incr', 'Hüfttiefe'],
      ['hip-scale-vert', 'decr', 'incr', 'Hüfthöhe'],
      ['hip-waist', 'down', 'up', 'Taille'],
      ['hip-trans', 'in', 'out', 'Position seitlich'],
      ['hip-trans', 'down', 'up', 'Position vertikal'],
      ['hip-trans', 'backward', 'forward', 'Position vor/zurück'],
    ],
  },
  {
    id: 'buttocks', label: 'Gesäß', dir: 'buttocks', items: [
      ['buttocks-volume', 'decr', 'incr', 'Gesäßvolumen'],
    ],
  },
  {
    id: 'pelvis', label: 'Becken', dir: 'pelvis', items: [
      ['pelvis-tone', 'decr', 'incr', 'Beckenspannung'],
    ],
  },
  {
    id: 'arms', label: 'Arme', dir: 'armslegs', items: [
      ['{s}-upperarm-scale-vert', 'decr', 'incr', 'Oberarm Länge'],
      ['{s}-upperarm-scale-horiz', 'decr', 'incr', 'Oberarm Breite'],
      ['{s}-upperarm-scale-depth', 'decr', 'incr', 'Oberarm Tiefe'],
      ['{s}-upperarm-muscle', 'decr', 'incr', 'Bizeps/Trizeps'],
      ['{s}-upperarm-fat', 'decr', 'incr', 'Oberarm Fett'],
      ['{s}-upperarm-shoulder-muscle', 'decr', 'incr', 'Schultermuskel (Deltoid)'],
      ['{s}-lowerarm-scale-vert', 'decr', 'incr', 'Unterarm Länge'],
      ['{s}-lowerarm-scale-horiz', 'decr', 'incr', 'Unterarm Breite'],
      ['{s}-lowerarm-scale-depth', 'decr', 'incr', 'Unterarm Tiefe'],
      ['{s}-lowerarm-muscle', 'decr', 'incr', 'Unterarm Muskel'],
      ['{s}-lowerarm-fat', 'decr', 'incr', 'Unterarm Fett'],
    ],
  },
  {
    id: 'hands', label: 'Hände', dir: 'armslegs', items: [
      ['{s}-hand-scale', 'decr', 'incr', 'Handgröße'],
      ['{s}-hand-fingers-length', 'decr', 'incr', 'Fingerlänge'],
      ['{s}-hand-fingers-diameter', 'decr', 'incr', 'Fingerdicke'],
      ['{s}-hand-fingers-distance', 'decr', 'incr', 'Fingerabstand'],
      ['{s}-hand-trans', 'in', 'out', 'Handposition'],
    ],
  },
  {
    id: 'legs', label: 'Beine', dir: 'armslegs', items: [
      ['upperlegs-height', 'decr', 'incr', 'Oberschenkel Länge (beide)'],
      ['lowerlegs-height', 'decr', 'incr', 'Unterschenkel Länge (beide)'],
      ['{s}-upperleg-scale-vert', 'decr', 'incr', 'Oberschenkel Höhe'],
      ['{s}-upperleg-scale-horiz', 'decr', 'incr', 'Oberschenkel Breite'],
      ['{s}-upperleg-scale-depth', 'decr', 'incr', 'Oberschenkel Tiefe'],
      ['{s}-upperleg-muscle', 'decr', 'incr', 'Oberschenkel Muskel'],
      ['{s}-upperleg-fat', 'decr', 'incr', 'Oberschenkel Fett'],
      ['{s}-lowerleg-scale-vert', 'decr', 'incr', 'Unterschenkel Höhe'],
      ['{s}-lowerleg-scale-horiz', 'decr', 'incr', 'Unterschenkel Breite'],
      ['{s}-lowerleg-scale-depth', 'decr', 'incr', 'Unterschenkel Tiefe'],
      ['{s}-lowerleg-muscle', 'decr', 'incr', 'Wade Muskel'],
      ['{s}-lowerleg-fat', 'decr', 'incr', 'Wade Fett'],
      ['{s}-leg-valgus', 'decr', 'incr', 'X-/O-Beine'],
    ],
  },
  {
    id: 'feet', label: 'Füße', dir: 'armslegs', items: [
      ['{s}-foot-scale', 'decr', 'incr', 'Fußgröße'],
      ['{s}-foot-scale-vert', 'decr', 'incr', 'Fußhöhe (Rist)'],
      ['{s}-foot-scale-horiz', 'decr', 'incr', 'Fußbreite'],
      ['{s}-foot-scale-depth', 'decr', 'incr', 'Fußlänge'],
      ['{s}-foot-trans', 'in', 'out', 'Position seitlich'],
      ['{s}-foot-trans', 'backward', 'forward', 'Position vor/zurück'],
      ['{s}-foot-trans', 'down', 'up', 'Position vertikal'],
    ],
  },
  {
    id: 'measure', label: 'Körpermaße', dir: 'measure', items: [
      ['measure-neck-circ', 'decr', 'incr', 'Halsumfang'],
      ['measure-neck-height', 'decr', 'incr', 'Halshöhe'],
      ['measure-shoulder-dist', 'decr', 'incr', 'Schulterbreite'],
      ['measure-frontchest-dist', 'decr', 'incr', 'Brustbreite vorne'],
      ['measure-bust-circ', 'decr', 'incr', 'Brustumfang'],
      ['measure-underbust-circ', 'decr', 'incr', 'Unterbrustumfang'],
      ['measure-waist-circ', 'decr', 'incr', 'Taillenumfang'],
      ['measure-napetowaist-dist', 'decr', 'incr', 'Rückenlänge'],
      ['measure-waisttohip-dist', 'decr', 'incr', 'Taille bis Hüfte'],
      ['measure-hips-circ', 'decr', 'incr', 'Hüftumfang'],
      ['measure-upperarm-circ', 'decr', 'incr', 'Oberarmumfang'],
      ['measure-upperarm-length', 'decr', 'incr', 'Oberarmlänge'],
      ['measure-lowerarm-length', 'decr', 'incr', 'Unterarmlänge'],
      ['measure-wrist-circ', 'decr', 'incr', 'Handgelenkumfang'],
      ['measure-thigh-circ', 'decr', 'incr', 'Oberschenkelumfang'],
      ['measure-upperleg-height', 'decr', 'incr', 'Oberschenkelhöhe'],
      ['measure-knee-circ', 'decr', 'incr', 'Knieumfang'],
      ['measure-calf-circ', 'decr', 'incr', 'Wadenumfang'],
      ['measure-lowerleg-height', 'decr', 'incr', 'Unterschenkelhöhe'],
      ['measure-ankle-circ', 'decr', 'incr', 'Knöchelumfang'],
    ],
  },
  {
    id: 'bodyshapes', label: 'Körpertypen', dir: 'bodyshapes', items: [
      ['bodyshapes-elvs-fem-apple', null, null, 'Apfel ♀'],
      ['bodyshapes-elvs-fem-triangle', null, null, 'Birne ♀'],
      ['bodyshapes-elvs-fem-full-hourglass', null, null, 'Sanduhr voll ♀'],
      ['bodyshapes-elvs-fem-neat-hourglass', null, null, 'Sanduhr schlank ♀'],
      ['bodyshapes-elvs-fem-invert-triangle', null, null, 'V-Form ♀'],
      ['bodyshapes-elvs-fem-lean-column', null, null, 'Schlanke Säule ♀'],
      ['bodyshapes-elvs-fem-rectangle', null, null, 'Rechteck ♀'],
      ['bodyshapes-elvs-fem-diamond', null, null, 'Raute ♀'],
      ['bodyshapes-elvs-fem-adrenal', null, null, 'Kompakt ♀'],
      ['bodyshapes-elvs-fem-liver', null, null, 'Rumpfbetont ♀'],
      ['bodyshapes-elvs-fem-ovary', null, null, 'Hüftbetont ♀'],
      ['bodyshapes-elvs-fem-thyroid', null, null, 'Feingliedrig ♀'],
      ['bodyshapes-elvs-man-apple', null, null, 'Apfel ♂'],
      ['bodyshapes-elvs-man-triangle', null, null, 'Birne ♂'],
      ['bodyshapes-elvs-man-trapezoid', null, null, 'Trapez ♂'],
      ['bodyshapes-elvs-man-invert-triangle', null, null, 'V-Form ♂'],
      ['bodyshapes-elvs-man-lean-column', null, null, 'Schlanke Säule ♂'],
      ['bodyshapes-elvs-man-rectangle', null, null, 'Rechteck ♂'],
      ['bodyshapes-elvs-man-adrenal', null, null, 'Kompakt ♂'],
      ['bodyshapes-elvs-man-liver', null, null, 'Rumpfbetont ♂'],
      ['bodyshapes-elvs-man-gonadal', null, null, 'Hüftbetont ♂'],
      ['bodyshapes-elvs-man-thyroid', null, null, 'Feingliedrig ♂'],
    ],
  },
];

// Asymmetry targets come in -l / -r pairs; one slider moves between them.
export const ASYM_ITEMS = [
  ['asym-brown-1', 'Brauen 1'], ['asym-brown-2', 'Brauen 2'],
  ['asym-cheek-1', 'Wangen 1'], ['asym-cheek-2', 'Wangen 2'],
  ['asym-ear-1', 'Ohren 1'], ['asym-ear-2', 'Ohren 2'], ['asym-ear-3', 'Ohren 3'], ['asym-ear-4', 'Ohren 4'],
  ['asym-eye-1', 'Augen 1'], ['asym-eye-2', 'Augen 2'], ['asym-eye-3', 'Augen 3'], ['asym-eye-4', 'Augen 4'],
  ['asym-eye-5', 'Augen 5'], ['asym-eye-6', 'Augen 6'], ['asym-eye-7', 'Augen 7'], ['asym-eye-8', 'Augen 8'],
  ['asym-jaw-1', 'Kiefer 1'], ['asym-jaw-2', 'Kiefer 2'], ['asym-jaw-3', 'Kiefer 3'],
  ['asym-mouth-1', 'Mund 1'], ['asym-mouth-2', 'Mund 2'],
  ['asym-nose-1', 'Nase 1'], ['asym-nose-2', 'Nase 2'], ['asym-nose-3', 'Nase 3'], ['asym-nose-4', 'Nase 4'],
  ['asym-temple-1', 'Schläfen 1'], ['asym-temple-2', 'Schläfen 2'],
  ['asym-top-1', 'Schädeldach 1'], ['asym-top-2', 'Schädeldach 2'],
  ['asymm-breast-1', 'Brust'], ['asymm-trunk-1', 'Rumpf'],
];

// Facial expression units (morph targets, one set per ethnic base).
export const EXPRESSION_UNITS = [
  ['eyebrows-left-down', 'Braue links senken'], ['eyebrows-right-down', 'Braue rechts senken'],
  ['eyebrows-left-up', 'Braue links heben'], ['eyebrows-right-up', 'Braue rechts heben'],
  ['eyebrows-left-inner-up', 'Braue links innen hoch'], ['eyebrows-right-inner-up', 'Braue rechts innen hoch'],
  ['eyebrows-left-extern-up', 'Braue links außen hoch'], ['eyebrows-right-extern-up', 'Braue rechts außen hoch'],
  ['eye-left-closure', 'Auge links schließen'], ['eye-right-closure', 'Auge rechts schließen'],
  ['eye-left-opened-up', 'Auge links aufreißen'], ['eye-right-opened-up', 'Auge rechts aufreißen'],
  ['eye-left-slit', 'Auge links zusammenkneifen'], ['eye-right-slit', 'Auge rechts zusammenkneifen'],
  ['nose-compression', 'Nase rümpfen'], ['nose-depression', 'Nase senken'],
  ['nose-left-dilatation', 'Nasenflügel links weiten'], ['nose-right-dilatation', 'Nasenflügel rechts weiten'],
  ['nose-left-elevation', 'Nasenflügel links heben'], ['nose-right-elevation', 'Nasenflügel rechts heben'],
  ['mouth-open', 'Mund öffnen'], ['mouth-corner-puller', 'Lächeln (Mundwinkel)'],
  ['mouth-upward-retraction', 'Oberlippe heben'], ['mouth-depression', 'Mundwinkel senken'],
  ['mouth-depression-retraction', 'Unterlippe senken'], ['mouth-elevation', 'Kinn hochschieben'],
  ['mouth-compression', 'Lippen pressen'], ['mouth-pursing', 'Lippen spitzen'],
  ['mouth-protusion', 'Lippen vorschieben'], ['mouth-eversion', 'Lippen stülpen'],
  ['mouth-retraction', 'Mund breit ziehen'], ['mouth-parling', 'Lippen öffnen'],
  ['mouth-part-later', 'Mund seitlich ziehen'], ['neck-platysma', 'Halsmuskel anspannen'],
];

export const EXPRESSION_PRESETS = {
  neutral: { label: 'Neutral', u: {} },
  smile: { label: 'Lächeln', u: { 'mouth-corner-puller': 0.75, 'eye-left-slit': 0.25, 'eye-right-slit': 0.25, 'mouth-retraction': 0.15 } },
  grin: { label: 'Strahlen', u: { 'mouth-corner-puller': 1, 'mouth-upward-retraction': 0.45, 'mouth-parling': 0.5, 'eye-left-slit': 0.45, 'eye-right-slit': 0.45, 'mouth-retraction': 0.3, 'eyebrows-left-extern-up': 0.2, 'eyebrows-right-extern-up': 0.2 } },
  laugh: { label: 'Lachen', u: { 'mouth-corner-puller': 1, 'mouth-open': 0.55, 'mouth-upward-retraction': 0.5, 'eye-left-slit': 0.6, 'eye-right-slit': 0.6, 'mouth-retraction': 0.35, 'eyebrows-left-up': 0.2, 'eyebrows-right-up': 0.2 } },
  sad: { label: 'Traurig', u: { 'mouth-depression': 0.7, 'eyebrows-left-inner-up': 0.8, 'eyebrows-right-inner-up': 0.8, 'mouth-elevation': 0.35, 'eye-left-closure': 0.15, 'eye-right-closure': 0.15 } },
  angry: { label: 'Wütend', u: { 'eyebrows-left-down': 0.9, 'eyebrows-right-down': 0.9, 'nose-compression': 0.45, 'mouth-compression': 0.6, 'eye-left-slit': 0.35, 'eye-right-slit': 0.35, 'nose-left-dilatation': 0.5, 'nose-right-dilatation': 0.5, 'neck-platysma': 0.3 } },
  rage: { label: 'Zornig', u: { 'eyebrows-left-down': 1, 'eyebrows-right-down': 1, 'nose-compression': 0.7, 'mouth-upward-retraction': 0.8, 'mouth-open': 0.3, 'mouth-retraction': 0.5, 'eye-left-opened-up': 0.3, 'eye-right-opened-up': 0.3, 'neck-platysma': 0.8, 'nose-left-dilatation': 0.8, 'nose-right-dilatation': 0.8 } },
  surprised: { label: 'Überrascht', u: { 'eyebrows-left-up': 1, 'eyebrows-right-up': 1, 'eye-left-opened-up': 0.8, 'eye-right-opened-up': 0.8, 'mouth-open': 0.45, 'mouth-pursing': 0.2 } },
  fear: { label: 'Ängstlich', u: { 'eyebrows-left-inner-up': 1, 'eyebrows-right-inner-up': 1, 'eyebrows-left-up': 0.4, 'eyebrows-right-up': 0.4, 'eye-left-opened-up': 0.9, 'eye-right-opened-up': 0.9, 'mouth-retraction': 0.6, 'mouth-parling': 0.4, 'neck-platysma': 0.6 } },
  disgust: { label: 'Angeekelt', u: { 'nose-compression': 0.9, 'mouth-upward-retraction': 0.7, 'nose-left-elevation': 0.6, 'nose-right-elevation': 0.6, 'eyebrows-left-down': 0.5, 'eyebrows-right-down': 0.5, 'eye-left-slit': 0.5, 'eye-right-slit': 0.5, 'mouth-depression': 0.3 } },
  skeptic: { label: 'Skeptisch', u: { 'eyebrows-left-up': 0.8, 'eyebrows-right-down': 0.5, 'mouth-part-later': 0.4, 'mouth-compression': 0.3, 'eye-right-slit': 0.35 } },
  wink: { label: 'Zwinkern', u: { 'eye-right-closure': 1, 'mouth-corner-puller': 0.6, 'mouth-part-later': 0.3, 'eyebrows-right-down': 0.3 } },
  kiss: { label: 'Kussmund', u: { 'mouth-pursing': 0.9, 'mouth-protusion': 0.8, 'eye-left-closure': 0.35, 'eye-right-closure': 0.35 } },
  pout: { label: 'Schmollen', u: { 'mouth-protusion': 0.6, 'mouth-eversion': 0.7, 'mouth-elevation': 0.6, 'mouth-depression': 0.4, 'eyebrows-left-inner-up': 0.5, 'eyebrows-right-inner-up': 0.5 } },
  sleepy: { label: 'Müde', u: { 'eye-left-closure': 0.55, 'eye-right-closure': 0.55, 'mouth-depression': 0.2, 'eyebrows-left-inner-up': 0.2, 'eyebrows-right-inner-up': 0.2 } },
  scream: { label: 'Schreien', u: { 'mouth-open': 1, 'mouth-retraction': 0.6, 'mouth-upward-retraction': 0.5, 'eyebrows-left-down': 0.6, 'eyebrows-right-down': 0.6, 'eye-left-slit': 0.5, 'eye-right-slit': 0.5, 'neck-platysma': 1, 'nose-compression': 0.4 } },
};

export const MACRO_DEFAULTS = {
  gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5,
  african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, breastSize: 0.5, breastFirmness: 0.5,
};

// Expand {s} patterns: returns list of modifier descriptors.
// desc: {id, group, label, sides: null | {l: id, r: id}, oneSided, targets: [minT, maxT]}
export function buildModifierList() {
  const list = [];
  for (const g of MODIFIER_GROUPS) {
    for (const [base, mn, mx, label] of g.items) {
      const mk = (b) => ({
        id: `${g.dir}/${b}${mn ? `|${mn}|${mx}` : ''}`,
        targets: mn ? [`${g.dir}/${b}-${mn}`, `${g.dir}/${b}-${mx}`] : [null, `${g.dir}/${b}`],
        oneSided: !mn,
      });
      if (base.includes('{s}')) {
        const l = mk(base.replace('{s}', 'l')), r = mk(base.replace('{s}', 'r'));
        list.push({ ...l, group: g.id, label: `${label} (L)`, side: 'l', pair: r.id });
        list.push({ ...r, group: g.id, label: `${label} (R)`, side: 'r', pair: l.id });
      } else {
        list.push({ ...mk(base), group: g.id, label });
      }
    }
  }
  for (const [base, label] of ASYM_ITEMS) {
    list.push({ id: `asym/${base}`, group: 'asym', label, targets: [`asym/${base}-l`, `asym/${base}-r`], oneSided: false });
  }
  return list;
}
