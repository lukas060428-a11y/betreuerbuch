// Textvorlagen für wiederkehrende Schreiben. Platzhalter in {{…}} werden mit Klientendaten gefüllt.

export const PLACEHOLDERS = [
  ['name', 'Vor- und Nachname'], ['vorname', 'Vorname'], ['nachname', 'Nachname'], ['geburtsdatum', 'Geburtsdatum'],
  ['adresse', 'Adresse'], ['gericht', 'Betreuungsgericht'], ['aktenzeichen', 'Aktenzeichen'],
  ['krankenkasse', 'Krankenkasse'], ['versichertennummer', 'Versichertennummer'],
  ['datum', 'heutiges Datum'], ['betreuer', 'eigener Name'], ['betreuer_kontakt', 'eigene Kontaktdaten'],
];

const SIGN = 'Mit freundlichen Grüßen\n\n{{betreuer}}\n{{betreuer_kontakt}}';

export const DEFAULT_TEMPLATES = [
  {
    id: 'tpl-bestellung',
    title: 'Bestellung als Betreuerin mitteilen',
    subject: 'Rechtliche Betreuung für {{name}}, geb. {{geburtsdatum}}',
    body: `Sehr geehrte Damen und Herren,

hiermit teile ich Ihnen mit, dass ich durch Beschluss des Betreuungsgerichts ({{gericht}}, Az. {{aktenzeichen}}) zur rechtlichen Betreuerin von

{{name}}, geb. {{geburtsdatum}}
wohnhaft {{adresse}}

bestellt wurde. Eine Kopie meines Betreuerausweises füge ich bei. Bitte richten Sie Schriftverkehr in den mir übertragenen Aufgabenkreisen künftig an mich.

${SIGN}`,
  },
  {
    id: 'tpl-kontoauszug',
    title: 'Kontoauszüge anfordern',
    subject: 'Kontoauszüge für {{name}}, geb. {{geburtsdatum}}',
    body: `Sehr geehrte Damen und Herren,

als rechtliche Betreuerin (Betreuungsgericht {{gericht}}, Az. {{aktenzeichen}}) bitte ich Sie, mir die Kontoauszüge von {{name}} für den Zeitraum vom ________ bis ________ zuzusenden.

Vielen Dank im Voraus.

${SIGN}`,
  },
  {
    id: 'tpl-frist',
    title: 'Fristverlängerung beantragen',
    subject: 'Fristverlängerung – {{name}}, geb. {{geburtsdatum}}',
    body: `Sehr geehrte Damen und Herren,

in der oben genannten Angelegenheit bitte ich als rechtliche Betreuerin von {{name}} um Verlängerung der Frist bis zum ________.

Begründung: ________

${SIGN}`,
  },
  {
    id: 'tpl-adresse',
    title: 'Adressänderung mitteilen',
    subject: 'Adressänderung – {{name}}, geb. {{geburtsdatum}}',
    body: `Sehr geehrte Damen und Herren,

hiermit teile ich Ihnen mit, dass {{name}} seit dem ________ unter folgender Anschrift wohnt:

{{adresse}}

Bitte ändern Sie Ihre Unterlagen entsprechend.

${SIGN}`,
  },
  {
    id: 'tpl-rueckruf',
    title: 'Bitte um Rückruf',
    subject: 'Bitte um Rückruf – {{name}}',
    body: `Sehr geehrte Damen und Herren,

in der Angelegenheit von {{name}}, geb. {{geburtsdatum}}, bitte ich um einen kurzen Rückruf. Sie erreichen mich unter den unten genannten Kontaktdaten.

${SIGN}`,
  },
];
