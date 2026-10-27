# GW-7 „Grauwolf“: Cockpit-Simulator

## Optimierter Auftrag

> Baue einen hochrealistischen **First-Person-Cockpitsimulator** eines zweibeinigen Roboters
> (Mech, ca. 10 m hoch), der vollständig im Browser läuft (WebGL 2, three.js, ohne Installation).
>
> **Zielplattform:** iPad Pro mit Safari, Hardware-Tastatur und Maus/Trackpad. Desktop-Browser
> laufen nebenbei mit. Eine Smartphone-Version gibt es nicht.
>
> **Perspektive:** ausschließlich aus dem Pilotensitz. Der Kopf ist frei drehbar (Maus), Zoom zum
> Ablesen kleiner Beschriftungen. Es gibt keine Außenkamera und keine Third-Person-Ansicht.
>
> **Cockpit:** eine geschlossene Panzerkapsel ohne Glas. Die Außensicht kommt über drei große
> Sensor-Displays (SDU), die die Bilder der Kopfkameras zeigen. Sie sind perspektivisch korrekt
> wie echte Fenster (Off-Axis-Projektion), mit Sensorrauschen, Pixelraster, TV/IR-Modus und
> HUD-Einblendung. Die Displays beleuchten das Cockpit.
>
> **Ausstattung (alles funktioniert):**
> - Hauptinstrumentenbrett: 3 Multifunktionsdisplays mit je 20 Softkeys, Warnlichtfeld,
>   Master Warnung/Vorsicht, analoge Reserveinstrumente, Uhr, Not-Aus
> - Linke Konsole: Kraftstoff, Hilfsturbine (APU), Hauptturbine (MTG), Fahrhebel, Licht
> - Rechte Konsole: Hydraulik, Kühlung, Navigation (INS/Kreisel), Sensoren, Bewegungssystem,
>   Steuerknüppel
> - Overhead: Elektrik mit Voltmeter, Sicherungsautomaten
> - Bedienelemente realistisch modelliert: Kippschalter (teils mit Schutzkappe), beleuchtete
>   Taster, Drehschalter, Dimmer, Sicherungen, Hebel. Jedes mit Tooltip, Animation und Klang.
>
> **Systemsimulation:** Batterie und Busse (Spannungseinbruch beim Anlassen), APU, Hauptturbine
> (N2, Abgastemperatur, Öldruck, Heißstart bei Fehlbedienung), Generatoren, Kraftstoff,
> Hydraulik A/B, Kühlung, INS-Ausrichtung, Kreisel, Aktuator-Kalibrierung, Haltung
> (Hocke/Stand), Fußsperre, Gangarten. Fehler und Warnungen laufen über ein Warnsystem.
>
> **Kaltstart-Prozedur:** gut 20 Schritte von „kalt und dunkel“ bis „bereit zum Gehen“. Dazu
> gehört eine Bootsequenz des Bordrechners mit POST-Text und eine Checkliste auf dem MFD, die
> live mitprüft. Fehlbedienungen haben Folgen.
>
> **Fortbewegung:** Fahrhebel und Lenkung, Schrittdynamik mit Kopfbewegung, Fußaufsetzer,
> Trägheit.
>
> **Grafik:** PBR-Materialien mit prozeduralen Texturen (Abnutzung, Schrauben, Kabelbäume,
> Hinweisschilder), hinterleuchtete Beschriftungen, Schatten, Bloom und Tonemapping.
> Außenwelt mit physikalischem Himmel, Gelände und Depot.
>
> **Audio:** prozedural erzeugt (Relais, Schalter, Turbinen, Pumpen, Servos, Schritte,
> Warntöne).
>
> **Vorgehen:** früh einen spielbaren Prototyp liefern und danach iterativ ausbauen.
> Zwischendurch unbearbeitete Screenshots schicken.

## Bedienung

| Eingabe | Wirkung |
| --- | --- |
| Klick ins Bild | Maus fangen (Blick mit der Maus, Fadenkreuz) |
| Esc | Maus freigeben (freier Zeiger, Ziehen = Blick) |
| Linksklick | Bedienelement betätigen (Kippschalter: obere/untere Hälfte) |
| Rechtsklick | Bedienelement in Gegenrichtung |
| Mausrad | Drehschalter/Dimmer drehen, sonst Zoom |
| Z (halten) | Zoom |
| 1 – 5 | Blick: vorne, Instrumente, linke Konsole, rechte Konsole, Overhead |
| W / S | Fahrhebel vor/zurück |
| A / D | Drehen |
| X | Fahrhebel auf STOP |
| H | Hilfe |
