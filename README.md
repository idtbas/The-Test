# Körper-Editor

Ein realistischer 3D-Körper- und Charakter-Editor, der komplett im Browser läuft – als
statische Seite direkt auf **GitHub Pages**. Optimiert für **iPad Pro (M4/M5) mit Safari**,
läuft aber auch auf jedem Desktop-Browser mit WebGL 2.

**Live:** https://idtbas.github.io/The-Test/

## Was man einstellen kann

| Bereich | Möglichkeiten |
| --- | --- |
| **Körper** | Geschlecht, Alter (1–90 Jahre), Muskulatur, Körperfett, Größe, Proportionen, Herkunft (Mischung), Brust |
| **Rumpf & Maße** | Oberkörper, Brust, Bauch (bis Schwangerschaft), Hüfte, Gesäß, Becken, 20 Körpermaße, 22 Körpertypen |
| **Gliedmaßen** | Ober-/Unterarme, Hände, Finger, Ober-/Unterschenkel, X-/O-Beine, Füße – links/rechts getrennt oder symmetrisch |
| **Skelett** | Knochenlänge und -stärke direkt im Skelett: Schädel, Kiefer, Wirbelsäule, Brustkorb, Schlüsselbein, Becken, Oberarm, Elle/Speiche, Hand, Finger, Oberschenkel, Schienbein, Fuß |
| **Kopf & Gesicht** | Kopfform, Stirn, Brauenbogen, Kinn & Kiefer, Wangen, Hals, Augen (17 Parameter je Seite), Nase (21), Mund (22), Ohren (11 je Seite), 31 Asymmetrie-Regler |
| **Mimik** | 15 Ausdrücke (Lächeln, Lachen, Wut, Angst, Ekel, Zwinkern …) mit Intensität, 34 einzelne Gesichtsmuskeln, Blick folgt der Kamera, natürliches Blinzeln |
| **Haut** | Physikalisches Melanin-/Hämoglobin-Modell (Hauttyp I–VI), Unterton, Rötung, Sommersprossen, Leberflecken, Venen, Altersflecken, Falten, Narben, Poren, Glanz, Nässe, Subsurface Scattering, Fantasiefarben |
| **Make-up** | Lippenstift, Lidschatten, Eyeliner, Rouge, Foundation, Nagellack |
| **Augen** | Prozedurale Iris mit Lichtbrechung durch die Hornhaut, zwei Farben, Struktur, Limbusring, Pupillengröße und -form (bis Katzenauge), Lederhaut, Äderchen, Heterochromie, Leuchten |
| **Haare** | Echte Einzelsträhnen (bis 80.000): 16 Frisuren, Länge, Dichte, Dicke, Volumen, Schwerkraft, Scheitel, Locken, Wellen, Frizz, Strähnigkeit; Haaransatz, Geheimratsecken, Tonsur, Koteletten, Undercut; Haarfarbe über Eu-/Phäomelanin, Grau, Strähnchen, Ombré, Färbung |
| **Bart & Brauen** | 10 Bartstile mit Länge/Dichte/Farbe, Augenbrauen (Form, Bogen, Dicke, Monobraue …), Wimpern, Körperbehaarung (bis Fell) |
| **Kleidung** | Unterwäsche, Sport-BH, Tanktop, T-Shirt, Langarm, Shorts, Leggings – passt sich jeder Körperform an |
| **Pose & Licht** | 7 Posen, 8 Licht-Setups (Fotostudio, Rembrandt, Tageslicht, Goldene Stunde, Gegenlicht, Neon …), Lichtrichtung, Brennweite, Farbwiedergabe (AgX/Neutral/ACES), Bildlook |

**Über die Grenzen:** Der ∞-Schalter erweitert alle Regler weit über realistische Werte –
für Elfen, Orks, Aliens, Zwerge, Riesen, Kobolde, Vampire und alles dazwischen. 15 Vorlagen
sind enthalten.

Weitere Funktionen: Rückgängig/Wiederholen, Zufallsgenerator (realistisch/extrem), Suche
über alle Regler, Speichern im Browser mit Vorschaubild, Export/Import als Datei,
Foto-Export (auf dem iPad direkt über das Teilen-Menü in die Fotos), Drehteller.

## Technik

- **Anatomie:** MakeHuman-Basismesh (CC0) mit 1274 verlustfrei komprimierten Morph-Targets
  (~9,5 MB), eigene Morph-Engine mit Makro-Interpolation und Extrapolation
- **Skelett:** 163 Knochen inkl. Gesicht, Finger, Zehen; Posen und Knochen-Skalierung,
  CPU-Skinning mit bis zu 12 Einflüssen je Vertex
- **Geometrie:** Catmull-Clark-Unterteilung über vorberechnete Stencils (~107.000 Dreiecke),
  komplette Pipeline in wenigen Millisekunden pro Reglerbewegung
- **Haut:** GPU-gebackene Texturen im UV-Raum anhand anatomischer 3D-Positionen;
  prozedurale Poren (physikalisch skaliert, Anti-Aliasing per Distanz), separables
  Subsurface Scattering (Jimenez), Lichttransmission über gebackene Gewebedicke (rot
  durchleuchtete Ohren im Gegenlicht), zweischichtige Spekularität, Pfirsichflaum
- **Augen:** Parallax-Refraktion der Iris durch die Hornhaut, additive Hornhaut-Reflexion
- **Haare:** Generierung im Web Worker (Voxel-Distanzfeld für Kollisionen, Kämmfeld,
  Strähnenbildung, Locken), Rendering per Instancing aus Float-Texturen, Marschner-artiges
  Shading mit Schatten
- **Bild:** HDR-Pipeline mit SSAO, 4×MSAA, Bloom, AgX-Tonemapping und progressivem
  Supersampling im Stillstand (Bild wird nach ~½ Sekunde glatt wie ein Offline-Render)

Kein Build-Schritt, keine externen Abhängigkeiten zur Laufzeit – alles liegt im Repository.

## Veröffentlichung (GitHub Pages)

GitHub Pages liefert den Branch `gh-pages` aus. Der Workflow `.github/workflows/pages-sync.yml`
spiegelt jeden Push auf `main` automatisch dorthin – nach ~1 Minute ist eine Änderung live unter
https://idtbas.github.io/The-Test/.

Auf dem iPad: In Safari öffnen → Teilen → „Zum Home-Bildschirm" für Vollbild ohne Browserleiste.

## Lokal starten

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Daten neu erzeugen (optional)

```sh
git clone --depth 1 https://github.com/makehumancommunity/makehuman.git
git clone --depth 1 https://github.com/makehumancommunity/mpfb2.git
python3 tools/build_data.py makehuman/makehuman/data mpfb2/src/mpfb/data
```

## Lizenzen

Eigener Code: MIT (siehe `LICENSE`). Anatomie-Daten: CC0 (MakeHuman/MPFB2).
three.js: MIT. Details in [CREDITS.md](CREDITS.md).
