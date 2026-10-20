# Credits & Lizenzen

## Anatomie-Daten: MakeHuman (CC0 1.0)

Basis-Mesh (hm08), Morph-Targets, Modifier-Definitionen, Skelett mit Skin-Gewichten,
Augen-Proxy und Gesichtsausdruck-Einheiten stammen aus dem
[MakeHuman-Projekt](http://www.makehumancommunity.org) und wurden von den Rechteinhabern
im September 2020 unter **CC0 1.0 Universal** freigegeben:

> Copyright (C) 2020 Data Collection AB, Joel Palmius, Jonas Hauquier
> (ursprünglich teilweise Manuel Bastioni, 2014)

Die Region-Masken (Lippen, Nägel, Ohren, Augenlider, Mundinnenraum, Brustwarzenhof) stammen
aus [MPFB2](https://github.com/makehumancommunity/mpfb2), ebenfalls als Assets unter CC0 1.0.

Die Daten wurden mit `tools/build_data.py` in ein kompaktes Binärformat umgewandelt
(verlustfrei, gzip). Es wurde **kein** Programmcode aus MakeHuman/MPFB übernommen – sämtliche
Logik (Morph-Engine, Skelett, Skinning, Unterteilung, Shader, Haare, UI) ist eigenständig
in JavaScript implementiert.

## three.js (MIT)

3D-Engine: [three.js](https://threejs.org) r185, © 2010-2026 three.js authors, MIT-Lizenz
(siehe `vendor/three/LICENSE`). Der AgX-/Neutral-Tone-Mapping-Code im Composite-Shader ist an
die three.js-Implementierung angelehnt.

## Verfahren

- Separables Subsurface Scattering nach Jimenez et al., „Separable Subsurface Scattering" (2015)
- Haut-Transmittanzprofil nach d'Eon & Luebke / Jimenez et al.
- Haar-Shading nach Kajiya-Kay mit verschobenen Glanzlichtern (Marschner-Näherung)
- Bump-Mapping ohne Tangenten nach Mikkelsen, „Bump Mapping Unparametrized Surfaces on the GPU"
