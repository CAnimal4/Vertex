/*
  ============================================================
  Vocab complexity-weighted scheduling (REQUIRED SPEC)
  ============================================================
  For each vocab entry compute a complexity score S:

    S = L_sp + L_en + (W_multi * num_words_sp) + (W_accent * has_accent) + (W_len_threshold * long_word_bonus)

  Where:
    - L_sp = length (characters) of Spanish text
    - L_en = length (characters) of English text
    - num_words_sp = number of words in Spanish
    - has_accent = 1 if Spanish contains any diacritic (á,é,í,ó,ú,ñ,ü), else 0
    - long_word_bonus = 1 if L_sp >= 8 else 0

  Weights:
    - W_multi = 4
    - W_accent = 5
    - W_len_threshold = 3

  Normalize S across the vocab pool to [0,1]:
    normS = (S - S_min) / (S_max - S_min)

  Selection:
    - default: weighted random sampling using normS (higher = more frequent)
    - small jitter + recency penalty are applied to avoid repeating the top items too often
*/

/*
  ============================================================
  Storage wrapper notes
  ============================================================
  - Primary persistence key:
      spanish_app_v2_state
  - Legacy fallback key:
      spanishPracticeApp_v1
  - getState() performs versioning + defensive schema validation/migration.
  - saveState() writes the entire state in one JSON blob with memory fallback.
*/

(() => {
  'use strict';

  const STORAGE_KEY = 'spanish_app_v2_state';
  const LEGACY_STORAGE_KEY = 'spanishPracticeApp_v1';
  const PROFILE_COOKIE_KEY = 'claro_profile_id';
  const APP_VERSION = 2;
  const ANALYTICS_VERSION = 2;
  // Paste the public Tally form URLs here after creating the two forms.
  // Example: https://tally.so/r/xxxxxx
  const TALLY_FEEDBACK_URL = 'https://tally.so/r/68grLO';
  const TALLY_PREMIUM_URL = 'https://tally.so/r/OD68ap';

  function openTallyForm(baseUrl, fields) {
    const url = new URL(baseUrl);
    Object.entries(fields).forEach(([key, value]) => {
      if (value != null && String(value)) url.searchParams.set(key, String(value));
    });
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  function tallyFeedbackType(value) {
    return ({ bug: 'Bug report', ui_request: 'UI request', improvement: 'Improvement request', module_request: 'New module request', feedback_system: 'Feedback about feedback system', general: 'Other' })[value] || 'Other';
  }

  window.APP_DEBUG = false;

  const MODULES = [
    { key: 'numbers',   name: 'Numbers' },
    { key: 'commands',  name: 'Command tone' },
    { key: 'vocab',     name: 'Honors Vocab' },
    { key: 'mayo_madness_1', name: 'Mayo Madness Level 1 Vocab' },
    { key: 'mayo_madness_2', name: 'Mayo Madness Level 2 Vocab' },
    { key: 'rapid_translations_2', name: 'Mayo Madness Level 2 Rapid Fire Translations' },
    { key: 'rapid_regular_verbs', name: 'Mayo Madness Level 2 Rapid Fire Regular Verb Conjugations' },
    { key: 'rapid_irregular_verbs', name: 'Mayo Madness Level 2 Rapid Fire Irregular Verb Conjugations' },
    { key: 'mayo_madness_3_rapid_translations', name: 'Mayo Madness Level 3: Rapid Fire Translations' },
    { key: 'reflexive', name: 'Reflexive verbs' },
    { key: 'tenses',    name: 'Tenses' },
    { key: 'days',      name: 'Days' },
    { key: 'months',    name: 'Months' },
    { key: 'seasons',   name: 'Seasons' },
    { key: 'time',      name: 'Time' },
    { key: 'colors',    name: 'Colors' },
    { key: 'prices',    name: 'Prices' },
    { key: 'weather',   name: 'Weather' },
    { key: 'clothing',  name: 'Clothing' },
    { key: 'foods',     name: 'Foods' },
    { key: 'present_progressive', name: 'Present Progressive' },
    { key: 'ser_estar', name: 'Ser / Estar' },
    { key: 'gustar',    name: 'Gustar' },
    { key: 'dates',     name: 'Dates' },
    { key: 'summer_time_words', name: 'Past-tense time words', level: 2, category: 'Summer Prep' },
    { key: 'summer_preterite', name: 'Preterite forms', level: 2, category: 'Summer Prep' },
    { key: 'summer_imperfect', name: 'Imperfect forms', level: 2, category: 'Summer Prep' },
    { key: 'summer_irregular_preterite', name: 'Irregular preterite', level: 2, category: 'Summer Prep' },
    { key: 'summer_irregular_imperfect', name: 'Irregular imperfect', level: 2, category: 'Summer Prep' },
    { key: 'summer_tense_choice', name: 'Preterite or imperfect?', level: 2, category: 'Summer Prep' },
    { key: 'summer_translations', name: 'Summer translation challenge', level: 2, category: 'Summer Prep' },
    { key: 'honors_ordinal_numbers', name: 'Ordinal Numbers', description: 'First, second, third, and beyond — ordinal numbers, gender agreement, and real sentence practice.', level: 2, category: 'Spanish 2 Honors' },
    { key: 'honors_test1_review', name: 'Test 1 Review', description: 'Preterite, imperfect, past-tense vocabulary, tense choice, and verb translation.', level: 2, category: 'Spanish 2 Honors' }
  ];

  const MAYO_MADNESS_KEY = 'mayo_madness';
  const MAYO_MADNESS_PASSWORDS = new Set();
  const PREMIUM_ACCESS_STORAGE_KEY = 'claro_premium_access_v1';
  const PREMIUM_ACCESS_COOKIE_KEY = 'claro_premium_access';
  const PREMIUM_ACCESS_DAY = 24 * 60 * 60 * 1000;
  // Beginner recognition drills stay fully free. Premium adds advanced forms,
  // sentence work, and a larger question pool to these modules.
  const PREMIUM_COMPLEX_MODULES = new Set([
    'commands', 'vocab', 'reflexive', 'tenses', 'prices', 'weather', 'clothing',
    'foods', 'present_progressive', 'ser_estar', 'gustar', 'dates',
    'summer_preterite', 'summer_imperfect', 'summer_irregular_preterite',
    'summer_irregular_imperfect', 'summer_tense_choice', 'summer_translations'
  ]);

  function readPremiumAccessRecord() {
    let raw = '';
    try { raw = localStorage.getItem(PREMIUM_ACCESS_STORAGE_KEY) || ''; } catch (_) {}
    if (!raw) {
      const cookie = document.cookie.split('; ').find((part) => part.startsWith(`${PREMIUM_ACCESS_COOKIE_KEY}=`));
      if (cookie) raw = decodeURIComponent(cookie.slice(PREMIUM_ACCESS_COOKIE_KEY.length + 1));
    }
    try {
      const record = JSON.parse(raw);
      if (!record || !['permanent', 'temporary'].includes(record.mode)) return null;
      if (record.mode === 'temporary' && Number(record.expiresAt) <= Date.now()) return null;
      return { mode: record.mode, expiresAt: Number(record.expiresAt) || 0 };
    } catch (_) {
      return null;
    }
  }

  function writePremiumAccessRecord(record) {
    const raw = JSON.stringify(record);
    try { localStorage.setItem(PREMIUM_ACCESS_STORAGE_KEY, raw); } catch (_) {}
    try {
      document.cookie = `${PREMIUM_ACCESS_COOKIE_KEY}=${encodeURIComponent(raw)}; max-age=31536000; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function clearPremiumAccessRecord() {
    try { localStorage.removeItem(PREMIUM_ACCESS_STORAGE_KEY); } catch (_) {}
    try { document.cookie = `${PREMIUM_ACCESS_COOKIE_KEY}=; max-age=0; path=/; SameSite=Lax`; } catch (_) {}
  }

  function premiumQuestionHash(id) {
    return String(id || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }

  function isPremiumQuestion(moduleKey, questionId) {
    return PREMIUM_COMPLEX_MODULES.has(moduleKey) && premiumQuestionHash(questionId) % 4 === 0;
  }
  const MAYO_MADNESS_SUBMODULE_KEYS = [
    'mayo_madness_1',
    'mayo_madness_2',
    'rapid_translations_2',
    'rapid_regular_verbs',
    'rapid_irregular_verbs',
    'mayo_madness_3_rapid_translations'
  ];

  function isMayoMadnessKey(key) {
    return MAYO_MADNESS_SUBMODULE_KEYS.includes(key);
  }

  const PERSONS = [
    { code: '1s', label: 'yo', display: 'yo (I)' },
    { code: '2s', label: 'tú', display: 'tú (you)' },
    { code: '3s', label: 'él/ella/usted', display: 'él/ella/usted (he/she/you formal)' },
    { code: '1p', label: 'nosotros', display: 'nosotros/nosotras (we)' },
    { code: '3p', label: 'ellos/ellas/ustedes', display: 'ellos/ellas/ustedes (they/you all)' }
  ];

  const HONORS_PERSONS = [
    { code: '1s', label: 'yo', display: 'yo (I)' },
    { code: '2s', label: 'tú', display: 'tú (you)' },
    { code: '3s', label: 'él/ella/usted', display: 'él/ella/usted (he/she/you formal)' },
    { code: '1p', label: 'nosotros', display: 'nosotros/nosotras (we)' },
    { code: '2p', label: 'vosotros', display: 'vosotros/vosotras (you all)' },
    { code: '3p', label: 'ellos/ellas/ustedes', display: 'ellos/ellas/ustedes (they/you all)' }
  ];

  // Normalized lists for tolerant matching.
  const LEADING_ARTICLES = ['el','la','los','las','un','una','unos','unas'];
  const LEADING_SUBJECTS = ['yo','tu','el','ella','usted','nosotros','nosotras','ellos','ellas','ustedes'];

  // "Pure numbers" filter lists (used ONLY to exclude *pure number* vocab cards; phrases that contain numbers are kept).
  const EN_NUMERIC = new Set([
    'one','two','three','four','five','six','seven','eight','nine','ten',
    'eleven','twelve','thirteen','fourteen','fifteen',
    'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety',
    'hundred','thousand',
    // hyphenated cases are tokenized into parts (one-hundred → one + hundred)
    'twenty','one','thirty','one','forty','one'
  ]);
  const ES_NUMERIC = new Set([
    'uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez',
    'once','doce','trece','catorce','quince',
    'veinte','veintiuno','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa',
    'cien','ciento',
    'doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos',
    'mil'
  ]);

  // --------------------------------------------
  // Quizlet vocab source (user-provided block)
  // --------------------------------------------
  // Replace this string to update vocab. Format: Spanish line, then English line, blank line between entries.
  // Pure-number cards are filtered out automatically.
  const QUIZLET_VOCAB_BLOCK = `
La Pared
The Wall


La Bandera
The Flag


El Piso
The Floor


El Suelo
The Ground/Floor


La Puerta
The Door


La Ventana
The Window


El Lápiz
The Pencil


La Pluma
The Pen


El Bolígrafo
The Pen


El Escritorio
The Desk


La Mesa
The Table


El Pupitre
The Desk


Las Manos
Hands


Los Ojos
Eyes


La Nariz
Nose


La Boca
Mouth


Las Orejas
Ears


El Hombro
Shoulder


El Estomágo
Stomach


Las Rodillas
Knees


Las Piernas
Legs


Los Dedos
Fingers


La Cara
Face


Hace Frío
It's Cold


Hace Calor
It's hot


El Tiempo
The Weather


Hace Sol
It's Sunny


¿Qué tiempo hace hoy?
How is the weather today


Hace Buen Tiempo
The Weather's Nice


Hace Mal Tiempo
The Weather's Bad


Hace Fresco
It's Cool Out


Está Nublado
It's Cloudy


Es la una
It's one o'clock


Media
half/thirty


Cuarto
fifteen/quarter


Mediodía
Noon


Medianoche
Midnight


Son las cinco
It's five o'clock


La Mochila
Backpack


El Cuaderno
Notebook


La Regla
Ruler


El Reloj
Clock


Las Tijeras
Scissors


El Borrador
Eraser


La Silla
Chair


El Maestro
Teacher


La Maestra
Female teacher


La Secundaria
High-school


La Preparatoria
High-school


La Escuela
School


El Colegio
School


La Biblioteca
Library


La Oficina
Office


El Baño
Bathroom


La Clase
Class


La Luz
Light


El Hermano
Brother


La Hermana
Sister


El Padre
Father


La Madre
Mother


El Abuelo
Grandpa


La Abuela
Grandma


El Primo
Cousin


La Prima
Female Cousin


Joven
Young


Viejo/a
Old


Mayor
Older


Menor
Younger


El Tío
Uncle


La Tía
Aunt


El Sobrino
Nephew


La Sobrina
Niece


La Casa
House


La Calle
Street


El Vecino
Neighbor


El Carro
Car


El Coche
Car


El Chico
Boy


La Chica
Girl


El Niño
Young boy


La Niña
Young girl


El Muchacho
Boy


La Muchacha
Girl


La Ciudad
City


El Pueblo
Town


El Otoño
Fall


La Primavera
Spring


El Verano
Summer


El Invierno
Winter


El Mes
Month


El Día
Day


La Semana
Week


La Hora
Hour


La Fecha
Date


Enero
January


El Lunes
Monday


El Mártes
Tuesday


El Miércoles
Wednesday


El Jueves
Thursday


El Viernes
Friday


El Sábado
Saturday


El Domingo
Sunday


El Fin de Semana
Weekend


Ser
To Be


Yo Soy
I am


Tú Eres
You are


él/Ella/Usted es
He/she/it is


Ellos/Ellas/Ustedes Son
They/you guys are


Nosotros/Nosotras Somos
We are


Estar
To be


Yo Estoy
I am


Tú Estás
You are


él/ella/usted está
He/she/it is


Ellos/Ellas/Ustedes Están
They/you guys are


Nosotros/Nosotros Estamos
We are


Ir
To go


Yo Fui
I went


Tú Fuiste
You went


él/Ella/Usted Fue
He/she/it went


Ellos/Ellas/Ustedes Fueron
They/you guys went


Nosotros/Nosotras Fuimos
We went


Hacer
To do/make


Yo Hice
I did


Tú Hiciste
You did


él/Ella/Usted Hizo
He/she/it did


Ellos/Ellas/Ustedes Hicieron
They/you guys did


Nosotros/Nosotras Hicimos
We did


Yo
I


Tú
You


él
He


Ella
She


Usted
You (formal)


Nosotros
We


Nosotras
We (feminine)


Ellos
They


Ellas
They (Feminine)


Ustedes
You guys/girls


El Infinitivo
Present tense, infinitive


El Preterito
Past tense, preterite


El Imperfecto
Imperfect, past tense


Veinte
Twenty


Veintiuno
Twenty-one


Treinta
Thirty


Cuarenta
Forty


Cincuenta
Fifty


Sesenta
Sixty


Setenta
Seventy


Ochenta
Eighty


Noventa
Ninety


Cien
One-hundred


Ciento uno
One hundred and one


Doscientos
200


Trescientos
300


Cuatrocientos
400


Quinientos
500


Seiscientos
600


Setecientos
700


Ochocientos
800


Novecientos
900


Mil
1000


Rojo/a
Red


Amarillo/a
Yellow


Blanco/a
White


Azul
Blue


Negro/a
Black


Verde
Green


Anaranjado/a
Orange


Púrpura
Purple


Morado/a
Purple


Rosado/a
Pink


Gris
Grey


Café
Brown


Castaño
Brown (hair, eyes)


Rubio/a
Blond


Pelirrojo/a
Red hair


Moreno/a
Dark hair/skin


El libro
Book


El Novio
Boyfriend


La novia
Girlfriend


Esposo
Husband


Esposa
Wife


Ganar
To win/earn


El Pie
Foot


El Caballo
Horse


La Vaca
Cow


Encantar
To love (like the verb gustar)


Gustar
To like


La Prueba
Quiz


Pues
Well..


Hasta Luego
Until later


La palabra
Word


El Camarero
Waiter


El Hijo
Son


La hija
Daughter


Comenzar
To start/begin


Vender
To sell


Llegar
To arrive


Poner
To put/place


Poder
Can/be able to


Salir
To leave/go out


Llevar
To take, carry, bring, wear


Hacer
to do, to make


Hice
I did/made


Hiciste
you did/made


Hizo
he/she did/made


Hicimos
we did/made


Hicieron
they did/made


Saber
to know (facts)


Supe
I knew/found out


Supiste
you knew (found out)


Supo
he/she knew


Supieron
they knew/found out


Supimos
we knew/found out


Poder
to be able, can


Pude
I could/ was able to


Pudiste
you could/were able to


Pudo
he/she could/was able to


Pudieron
they could/was able to


pudimos
we could/were able to


Ir
to go


Voy
I go/am going


Vas
you go/you are going


Va
he/she goes/is going


Van
They go/are going


Vamos
We go/are going


la primavera
spring


el verano
summer


el otoño
fall, autumn


el invierno
winter


enero
January


alto/a
tall


bajo/a
short (height)


present progressive: estar + ando (ar)
estoy hablando


present progressive: estar + iendo (er/ir)
estoy comiendo


amable
kind


antipatico/simpatico
mean/nice
`;

  // --------------------------------------------
  // Numbers module (original behavior preserved)
  // --------------------------------------------
  function clampNumberBound(value, fallback = 1) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : fallback;
  }

  function clampNumberMax(value) {
    return clampNumberBound(value, 1000);
  }

  function normalizeNumberRange(minValue, maxValue) {
    const min = clampNumberBound(minValue, 1);
    const max = clampNumberBound(maxValue, 1000);
    return min <= max ? { min, max } : { min: max, max: min };
  }

  function rand(min = 1, max = 1000) {
    const range = normalizeNumberRange(min, max);
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }

  // Arrays from the original numbers app:
  const upto29 = [
    "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
    "diez", "once", "doce", "trece", "catorce", "quince",
    "dieciséis", "diecisiete", "dieciocho", "diecinueve",
    "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
    "veintiséis", "veintisiete", "veintiocho", "veintinueve"
  ];

  const tens = {
    30: "treinta",
    40: "cuarenta",
    50: "cincuenta",
    60: "sesenta",
    70: "setenta",
    80: "ochenta",
    90: "noventa"
  };

  const hundreds = {
    100: "cien",
    200: "doscientos",
    300: "trescientos",
    400: "cuatrocientos",
    500: "quinientos",
    600: "seiscientos",
    700: "setecientos",
    800: "ochocientos",
    900: "novecientos"
  };

  function numberToSpanish(n) {
    if (n === 1000) return "mil";
    if (n <= 29) return upto29[n];
    if (n < 100) {
      const t = Math.floor(n / 10) * 10;
      const r = n % 10;
      return r === 0 ? tens[t] : tens[t] + " y " + upto29[r];
    }
    if (n < 200) {
      if (n === 100) return "cien";
      return "ciento " + numberToSpanish(n - 100);
    }
    const h = Math.floor(n / 100) * 100;
    const r = n % 100;
    return r === 0 ? hundreds[h] : hundreds[h] + " " + numberToSpanish(r);
  }

  // Generate a "similar" number (original behavior) to practice tough ranges.
  function generateSimilar(n, min = 1, max = 1000) {
    const range = normalizeNumberRange(min, max);
    const clampToRange = (candidate) => Math.max(range.min, Math.min(range.max, candidate));
    if (n >= range.max) return range.max;
    if (n <= 29) {
      const offset = Math.floor(Math.random() * 5) - 2;
      const similar = n + offset;
      return clampToRange(similar);
    }
    if (n < 100) {
      const t = Math.floor(n / 10) * 10;
      const r = n % 10;
      const newR = Math.max(0, Math.min(9, r + (Math.floor(Math.random() * 5) - 2)));
      const candidate = t + newR;
      return clampToRange(candidate < 30 ? 30 : candidate);
    }
    if (n < 1000) {
      const h = Math.floor(n / 100) * 100;
      let r = n % 100;
      r += Math.floor(Math.random() * 21) - 10;
      r = Math.max(0, Math.min(99, r));
      let candidate = h + r;
      if (candidate === 0) candidate = 100;
      return clampToRange(candidate);
    }
    return rand(range.min, range.max);
  }

  // --------------------------------------------
  // New module pools + helpers
  // --------------------------------------------
  const DAYS_POOL = [
    { id: 'days-lunes', sp: 'el lunes', en: 'Monday' },
    { id: 'days-martes', sp: 'el martes', en: 'Tuesday' },
    { id: 'days-miercoles', sp: 'el miércoles', en: 'Wednesday' },
    { id: 'days-jueves', sp: 'el jueves', en: 'Thursday' },
    { id: 'days-viernes', sp: 'el viernes', en: 'Friday' },
    { id: 'days-sabado', sp: 'el sábado', en: 'Saturday' },
    { id: 'days-domingo', sp: 'el domingo', en: 'Sunday' }
  ];

  const MONTHS_POOL = [
    { id: 'months-enero', sp: 'enero', en: 'January' },
    { id: 'months-febrero', sp: 'febrero', en: 'February' },
    { id: 'months-marzo', sp: 'marzo', en: 'March' },
    { id: 'months-abril', sp: 'abril', en: 'April' },
    { id: 'months-mayo', sp: 'mayo', en: 'May' },
    { id: 'months-junio', sp: 'junio', en: 'June' },
    { id: 'months-julio', sp: 'julio', en: 'July' },
    { id: 'months-agosto', sp: 'agosto', en: 'August' },
    { id: 'months-septiembre', sp: 'septiembre', en: 'September' },
    { id: 'months-octubre', sp: 'octubre', en: 'October' },
    { id: 'months-noviembre', sp: 'noviembre', en: 'November' },
    { id: 'months-diciembre', sp: 'diciembre', en: 'December' }
  ];

  const SEASONS_POOL = [
    { id: 'seasons-primavera', sp: 'la primavera', en: 'spring' },
    { id: 'seasons-verano', sp: 'el verano', en: 'summer' },
    { id: 'seasons-otono', sp: 'el otoño', en: 'fall' },
    { id: 'seasons-invierno', sp: 'el invierno', en: 'winter' }
  ];

  const COLORS_POOL = [
    { id: 'colors-rojo', sp: 'rojo', en: 'red' },
    { id: 'colors-azul', sp: 'azul', en: 'blue' },
    { id: 'colors-verde', sp: 'verde', en: 'green' },
    { id: 'colors-amarillo', sp: 'amarillo', en: 'yellow' },
    { id: 'colors-negro', sp: 'negro', en: 'black' },
    { id: 'colors-blanco', sp: 'blanco', en: 'white' },
    { id: 'colors-gris', sp: 'gris', en: 'gray' },
    { id: 'colors-morado', sp: 'morado', en: 'purple', acceptable: ['morado', 'violeta'] },
    { id: 'colors-rosado', sp: 'rosado', en: 'pink', acceptable: ['rosado', 'rosa'] },
    { id: 'colors-anaranjado', sp: 'anaranjado', en: 'orange', acceptable: ['anaranjado', 'naranja'] },
    { id: 'colors-cafe', sp: 'café', en: 'brown', acceptable: ['café', 'marrón'] },
    { id: 'colors-plateado', sp: 'plateado', en: 'silver' },
    { id: 'colors-dorado', sp: 'dorado', en: 'gold' },
    { id: 'colors-beige', sp: 'beige', en: 'beige' },
    { id: 'colors-turquesa', sp: 'turquesa', en: 'turquoise' },
    { id: 'colors-violeta', sp: 'violeta', en: 'violet' }
  ];

  const MAYO_MADNESS_LEVEL_1_POOL = [
    { id: 'mayo1-lapiz', sp: 'el lápiz', en: 'the pencil' },
    { id: 'mayo1-silla', sp: 'la silla', en: 'the chair' },
    { id: 'mayo1-escritorio', sp: 'el escritorio', en: 'the desk', acceptable: ['el escritorio', 'el pupitre'] },
    { id: 'mayo1-suelo', sp: 'el suelo / el piso', en: 'the floor', acceptable: ['el suelo', 'el piso'] },
    { id: 'mayo1-reloj', sp: 'el reloj', en: 'the clock' },
    { id: 'mayo1-cuaderno', sp: 'el cuaderno', en: 'the notebook' },
    { id: 'mayo1-papel', sp: 'el papel', en: 'the paper' },
    { id: 'mayo1-mochila', sp: 'la mochila', en: 'the backpack' },
    { id: 'mayo1-maestro', sp: 'el maestro / la maestra', en: 'the teacher', acceptable: ['el maestro', 'la maestra'] }
  ];

  const MAYO_MADNESS_LEVEL_2_POOL = [
    { id: 'mayo2-libro', sp: 'el libro', en: 'book' },
    { id: 'mayo2-puerta', sp: 'la puerta', en: 'door' },
    { id: 'mayo2-ventana', sp: 'la ventana', en: 'window' },
    { id: 'mayo2-computadora', sp: 'la computadora / el ordenador', en: 'computer', acceptable: ['la computadora', 'el ordenador'] },
    { id: 'mayo2-bandera', sp: 'la bandera', en: 'flag' },
    { id: 'mayo2-pizarra', sp: 'la pizarra / la pizarra blanca', en: 'whiteboard', acceptable: ['la pizarra', 'la pizarra blanca'] },
    { id: 'mayo2-mochila', sp: 'la mochila', en: 'backpack' }
  ];

  const RAPID_TRANSLATIONS_LEVEL_2_POOL = [
    {
      id: 'rapid2-sisters',
      en: 'I have 5 tall sisters with blue eyes',
      sp: 'Tengo cinco hermanas altas con ojos azules',
      acceptable: [
        'Tengo cinco hermanas altas con ojos azules',
        'Yo tengo cinco hermanas altas con ojos azules',
        'Tengo 5 hermanas altas con ojos azules',
        'Yo tengo 5 hermanas altas con ojos azules'
      ]
    },
    {
      id: 'rapid2-live-beach',
      en: 'We live at the beach',
      sp: 'Vivimos en la playa',
      acceptable: ['Vivimos en la playa', 'Nosotros vivimos en la playa', 'Nosotras vivimos en la playa']
    },
    {
      id: 'rapid2-friends-beach',
      en: 'My friends go to the beach every day',
      sp: 'Mis amigos van a la playa todos los días',
      acceptable: [
        'Mis amigos van a la playa todos los días',
        'Mis amigas van a la playa todos los días',
        'Mis amigos van a la playa cada día',
        'Mis amigas van a la playa cada día'
      ]
    },
    {
      id: 'rapid2-eat-food',
      en: 'You need to eat more food',
      sp: 'Necesitas comer más comida',
      acceptable: [
        'Necesitas comer más comida',
        'Tú necesitas comer más comida',
        'Usted necesita comer más comida',
        'Necesita comer más comida'
      ]
    },
    {
      id: 'rapid2-store',
      en: 'I am going to go to the store',
      sp: 'Voy a ir a la tienda',
      acceptable: ['Voy a ir a la tienda', 'Yo voy a ir a la tienda']
    }
  ];

  const RAPID_REGULAR_VERB_POOL = [
    { id: 'rapid-reg-work', en: 'We work', sp: 'Trabajamos', acceptable: ['Trabajamos', 'Nosotros trabajamos', 'Nosotras trabajamos'] },
    { id: 'rapid-reg-play', en: 'We play', sp: 'Jugamos', acceptable: ['Jugamos', 'Nosotros jugamos', 'Nosotras jugamos'] },
    { id: 'rapid-reg-talk', en: 'We talk', sp: 'Hablamos', acceptable: ['Hablamos', 'Nosotros hablamos', 'Nosotras hablamos'] },
    { id: 'rapid-reg-watch', en: 'We watch', sp: 'Miramos / Vemos', acceptable: ['Miramos', 'Vemos', 'Nosotros miramos', 'Nosotras miramos', 'Nosotros vemos', 'Nosotras vemos'] },
    { id: 'rapid-reg-see', en: 'We see', sp: 'Vemos', acceptable: ['Vemos', 'Nosotros vemos', 'Nosotras vemos'] },
    { id: 'rapid-reg-run', en: 'We run', sp: 'Corremos', acceptable: ['Corremos', 'Nosotros corremos', 'Nosotras corremos'] },
    { id: 'rapid-reg-clean', en: 'We clean', sp: 'Limpiamos', acceptable: ['Limpiamos', 'Nosotros limpiamos', 'Nosotras limpiamos'] },
    { id: 'rapid-reg-dance', en: 'We dance', sp: 'Bailamos', acceptable: ['Bailamos', 'Nosotros bailamos', 'Nosotras bailamos'] }
  ];

  const RAPID_IRREGULAR_VERB_POOL = [
    { id: 'rapid-irreg-have', en: 'We have', sp: 'Tenemos', acceptable: ['Tenemos', 'Nosotros tenemos', 'Nosotras tenemos'] },
    { id: 'rapid-irreg-can', en: 'We can', sp: 'Podemos', acceptable: ['Podemos', 'Nosotros podemos', 'Nosotras podemos'] },
    { id: 'rapid-irreg-know', en: 'I know', sp: 'Sé / Conozco', acceptable: ['Sé', 'Se', 'Yo sé', 'Yo se', 'Conozco', 'Yo conozco'], note: 'Sé is for facts; conozco is for people or places.' },
    { id: 'rapid-irreg-say', en: 'I say/tell', sp: 'Digo', acceptable: ['Digo', 'Yo digo'] },
    { id: 'rapid-irreg-leave', en: 'I leave/go out', sp: 'Salgo', acceptable: ['Salgo', 'Yo salgo'] },
    { id: 'rapid-irreg-do', en: 'I do/make', sp: 'Hago', acceptable: ['Hago', 'Yo hago'] },
    { id: 'rapid-irreg-go', en: 'They go', sp: 'Van', acceptable: ['Van', 'Ellos van', 'Ellas van', 'Ustedes van'] },
    { id: 'rapid-irreg-ser', en: 'We are (ser)', sp: 'Somos', acceptable: ['Somos', 'Nosotros somos', 'Nosotras somos'] },
    { id: 'rapid-irreg-estar', en: 'We are (estar)', sp: 'Estamos', acceptable: ['Estamos', 'Nosotros estamos', 'Nosotras estamos'] }
  ];

  const MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL = [
    {
      id: 'mayo3-hurry-hungry',
      en: 'We are in a hurry and we are hungry',
      sp: 'Estamos apurados y tenemos hambre',
      acceptable: [
        'Estamos apurados y tenemos hambre',
        'Estamos apuradas y tenemos hambre',
        'Nosotros estamos apurados y tenemos hambre',
        'Nosotras estamos apuradas y tenemos hambre',
        'Estamos con prisa y tenemos hambre',
        'Nosotros estamos con prisa y tenemos hambre',
        'Nosotras estamos con prisa y tenemos hambre'
      ]
    },
    {
      id: 'mayo3-close-beach',
      en: 'I am close to the beach',
      sp: 'Estoy cerca de la playa',
      acceptable: ['Estoy cerca de la playa', 'Yo estoy cerca de la playa']
    },
    {
      id: 'mayo3-live-far-school',
      en: 'They live far from the school',
      sp: 'Ellos viven lejos de la escuela',
      acceptable: [
        'Ellos viven lejos de la escuela',
        'Ellas viven lejos de la escuela',
        'Viven lejos de la escuela',
        'Ellos viven lejos del colegio',
        'Ellas viven lejos del colegio',
        'Viven lejos del colegio'
      ]
    },
    {
      id: 'mayo3-play-game',
      en: 'She has to play in a game today',
      sp: 'Ella tiene que jugar en un partido hoy',
      acceptable: [
        'Ella tiene que jugar en un partido hoy',
        'Tiene que jugar en un partido hoy',
        'Ella debe jugar en un juego hoy',
        'Debe jugar en un juego hoy',
        'Ella tiene que jugar en un juego hoy',
        'Tiene que jugar en un juego hoy'
      ]
    },
    {
      id: 'mayo3-we-had',
      en: 'We had',
      sp: 'Tuvimos / Teníamos',
      acceptable: ['Tuvimos', 'Teníamos', 'Nosotros tuvimos', 'Nosotras tuvimos', 'Nosotros teníamos', 'Nosotras teníamos'],
      note: 'Tuvimos is completed action; teníamos is ongoing or habitual past.'
    },
    {
      id: 'mayo3-we-could',
      en: 'We could',
      sp: 'Pudimos / Podíamos',
      acceptable: ['Pudimos', 'Podíamos', 'Nosotros pudimos', 'Nosotras pudimos', 'Nosotros podíamos', 'Nosotras podíamos'],
      note: 'Pudimos means managed to; podíamos means could in general or used to be able to.'
    },
    {
      id: 'mayo3-i-knew',
      en: 'I knew',
      sp: 'Supe / Sabía',
      acceptable: ['Supe', 'Sabía', 'Yo supe', 'Yo sabía'],
      note: 'Supe means found out; sabía means already knew.'
    },
    {
      id: 'mayo3-i-said',
      en: 'I said / told',
      sp: 'Dije',
      acceptable: ['Dije', 'Yo dije']
    },
    {
      id: 'mayo3-i-was-place',
      en: 'I was (in a place)',
      sp: 'Estuve / Estaba',
      acceptable: ['Estuve', 'Estaba', 'Yo estuve', 'Yo estaba'],
      note: 'Estuve is temporary/completed; estaba is ongoing.'
    },
    {
      id: 'mayo3-i-did-made',
      en: 'I did / made',
      sp: 'Hice',
      acceptable: ['Hice', 'Yo hice']
    },
    {
      id: 'mayo3-bed-late',
      en: 'They go to bed very late',
      sp: 'Ellos se acuestan muy tarde',
      acceptable: ['Ellos se acuestan muy tarde', 'Ellas se acuestan muy tarde', 'Se acuestan muy tarde']
    },
    {
      id: 'mayo3-they-went',
      en: 'They went',
      sp: 'Fueron',
      acceptable: ['Fueron', 'Ellos fueron', 'Ellas fueron']
    },
    {
      id: 'mayo3-we-were-estar',
      en: 'We were (estar)',
      sp: 'Estuvimos / Estábamos',
      acceptable: ['Estuvimos', 'Estábamos', 'Nosotros estuvimos', 'Nosotras estuvimos', 'Nosotros estábamos', 'Nosotras estábamos'],
      note: 'Estuvimos is completed; estábamos is ongoing.'
    }
  ];

  const COLOR_CONFUSABLES = {
    rojo: ['rosado','anaranjado','morado'],
    azul: ['morado','verde','gris'],
    verde: ['azul','amarillo','gris'],
    amarillo: ['anaranjado','verde','blanco'],
    negro: ['gris','morado','azul'],
    blanco: ['gris','amarillo','rosado'],
    gris: ['blanco','negro','azul'],
    morado: ['azul','rosado','rojo'],
    rosado: ['rojo','morado','blanco'],
    anaranjado: ['rojo','amarillo','rosado'],
    cafe: ['anaranjado','morado','negro']
  };

  const TIME_POOL = [
    { id: 'time-0000', display: 'Medianoche', hour24: 0, minute: 0 },
    { id: 'time-0030', display: 'Son las doce y media', hour24: 0, minute: 30 },
    { id: 'time-0100', display: 'Es la una', hour24: 1, minute: 0 },
    { id: 'time-0115', display: 'Es la una y cuarto', hour24: 1, minute: 15 },
    { id: 'time-0130', display: 'Es la una y media', hour24: 1, minute: 30 },
    { id: 'time-0200', display: 'Son las dos', hour24: 2, minute: 0 },
    { id: 'time-0210', display: 'Son las dos y diez', hour24: 2, minute: 10 },
    { id: 'time-0235', display: 'Son las dos y treinta y cinco', hour24: 2, minute: 35 },
    { id: 'time-0300', display: 'Son las tres', hour24: 3, minute: 0 },
    { id: 'time-0330', display: 'Son las tres y media', hour24: 3, minute: 30 },
    { id: 'time-0345', display: 'Son las cuatro menos cuarto', hour24: 3, minute: 45 },
    { id: 'time-0415', display: 'Son las cuatro y cuarto', hour24: 4, minute: 15 },
    { id: 'time-0500', display: 'Son las cinco', hour24: 5, minute: 0 },
    { id: 'time-0545', display: 'Son las seis menos cuarto', hour24: 5, minute: 45 },
    { id: 'time-0610', display: 'Son las seis y diez', hour24: 6, minute: 10 },
    { id: 'time-0700', display: 'Son las siete', hour24: 7, minute: 0 },
    { id: 'time-0710', display: 'Son las siete y diez', hour24: 7, minute: 10 },
    { id: 'time-0800', display: 'Son las ocho', hour24: 8, minute: 0 },
    { id: 'time-0830', display: 'Son las ocho y media', hour24: 8, minute: 30 },
    { id: 'time-0900', display: 'Son las nueve', hour24: 9, minute: 0 },
    { id: 'time-0915', display: 'Son las nueve y cuarto', hour24: 9, minute: 15 },
    { id: 'time-0945', display: 'Son las diez menos cuarto', hour24: 9, minute: 45 },
    { id: 'time-1000', display: 'Son las diez', hour24: 10, minute: 0 },
    { id: 'time-1035', display: 'Son las diez y treinta y cinco', hour24: 10, minute: 35 },
    { id: 'time-1100', display: 'Son las once', hour24: 11, minute: 0 },
    { id: 'time-1135', display: 'Son las once y treinta y cinco', hour24: 11, minute: 35 },
    { id: 'time-1200', display: 'Mediodía', hour24: 12, minute: 0 },
    { id: 'time-1215', display: 'Son las doce y cuarto', hour24: 12, minute: 15 },
    { id: 'time-1300', display: 'Es la una', hour24: 13, minute: 0 },
    { id: 'time-1330', display: 'Es la una y media', hour24: 13, minute: 30 },
    { id: 'time-1345', display: 'Son las dos menos cuarto', hour24: 13, minute: 45 },
    { id: 'time-1410', display: 'Son las dos y diez', hour24: 14, minute: 10 },
    { id: 'time-1500', display: 'Son las tres', hour24: 15, minute: 0 },
    { id: 'time-1610', display: 'Son las cuatro y diez', hour24: 16, minute: 10 },
    { id: 'time-1730', display: 'Son las cinco y media', hour24: 17, minute: 30 },
    { id: 'time-1815', display: 'Son las seis y cuarto', hour24: 18, minute: 15 },
    { id: 'time-1935', display: 'Son las siete y treinta y cinco', hour24: 19, minute: 35 },
    { id: 'time-2000', display: 'Son las ocho', hour24: 20, minute: 0 },
    { id: 'time-2115', display: 'Son las nueve y cuarto', hour24: 21, minute: 15 },
    { id: 'time-2230', display: 'Son las diez y media', hour24: 22, minute: 30 },
    { id: 'time-2345', display: 'Son las doce menos cuarto', hour24: 23, minute: 45 }
  ];

  const WEATHER_POOL = [
    { id: 'weather-cold', en: "it's cold", sp: 'hace frío' },
    { id: 'weather-hot', en: "it's hot", sp: 'hace calor' },
    { id: 'weather-cool', en: "it's cool", sp: 'hace fresco' },
    { id: 'weather-sunny', en: "it's sunny", sp: 'hace sol', acceptable: ['hace sol', 'está soleado'] },
    { id: 'weather-cloudy', en: "it's cloudy", sp: 'está nublado' },
    { id: 'weather-rainy', en: "it's rainy", sp: 'está lluvioso', acceptable: ['está lluvioso', 'está lloviendo', 'llueve'] },
    { id: 'weather-raining', en: "it's raining", sp: 'está lloviendo', acceptable: ['está lloviendo', 'llueve'] },
    { id: 'weather-windy', en: "it's windy", sp: 'hace viento' },
    { id: 'weather-snowing', en: "it's snowing", sp: 'está nevando' },
    { id: 'weather-foggy', en: "it's foggy", sp: 'hay niebla' },
    { id: 'weather-stormy', en: "it's stormy", sp: 'hay tormenta' },
    { id: 'weather-humid', en: "it's humid", sp: 'está húmedo' },
    { id: 'weather-dry', en: "it's dry", sp: 'está seco' },
    { id: 'weather-lightning', en: "there is lightning", sp: 'hay relámpagos' },
    { id: 'weather-thunder', en: "there is thunder", sp: 'hay truenos' },
    { id: 'weather-freezing', en: "it's freezing", sp: 'hace mucho frío' },
    { id: 'weather-perfect', en: "the weather is perfect", sp: 'hace un tiempo perfecto' },
    { id: 'weather-bad', en: "the weather is bad", sp: 'hace mal tiempo' },
    { id: 'weather-good', en: "the weather is good", sp: 'hace buen tiempo' },
    { id: 'weather-overcast', en: "it's overcast", sp: 'está cubierto' },
    { id: 'weather-drizzle', en: "it's drizzling", sp: 'está lloviznando' },
    { id: 'weather-weather-today', en: "how is the weather today?", sp: '¿qué tiempo hace hoy?' },
    { id: 'weather-temp-drops', en: "the temperature drops", sp: 'la temperatura baja' },
    { id: 'weather-temp-rises', en: "the temperature rises", sp: 'la temperatura sube' },
    { id: 'weather-clear', en: "the sky is clear", sp: 'el cielo está despejado' },
    { id: 'weather-partly-cloudy', en: "it's partly cloudy", sp: 'está parcialmente nublado' }
  ];

  const CLOTHING_POOL = [
    { id: 'clothing-shirt', en: 'shirt', sp: 'la camisa' },
    { id: 'clothing-pants', en: 'pants', sp: 'los pantalones' },
    { id: 'clothing-shoes', en: 'shoes', sp: 'los zapatos' },
    { id: 'clothing-jacket', en: 'jacket', sp: 'la chaqueta' },
    { id: 'clothing-dress', en: 'dress', sp: 'el vestido' },
    { id: 'clothing-skirt', en: 'skirt', sp: 'la falda' },
    { id: 'clothing-socks', en: 'socks', sp: 'los calcetines' },
    { id: 'clothing-hat', en: 'hat', sp: 'el sombrero' },
    { id: 'clothing-coat', en: 'coat', sp: 'el abrigo' },
    { id: 'clothing-sweater', en: 'sweater', sp: 'el suéter' },
    { id: 'clothing-shorts', en: 'shorts', sp: 'los shorts', acceptable: ['los shorts', 'los pantalones cortos'] },
    { id: 'clothing-boots', en: 'boots', sp: 'las botas' },
    { id: 'clothing-belt', en: 'belt', sp: 'el cinturón' },
    { id: 'clothing-gloves', en: 'gloves', sp: 'los guantes' },
    { id: 'clothing-scarf', en: 'scarf', sp: 'la bufanda' },
    { id: 'clothing-tie', en: 'tie', sp: 'la corbata' },
    { id: 'clothing-hoodie', en: 'hoodie', sp: 'la sudadera' },
    { id: 'clothing-jeans', en: 'jeans', sp: 'los jeans' },
    { id: 'clothing-sandals', en: 'sandals', sp: 'las sandalias' },
    { id: 'clothing-sneakers', en: 'sneakers', sp: 'los tenis', acceptable: ['los tenis', 'las zapatillas', 'los zapatos deportivos'] },
    { id: 'clothing-shirt-f', en: 'blouse', sp: 'la blusa' },
    { id: 'clothing-underwear', en: 'underwear', sp: 'la ropa interior' },
    { id: 'clothing-pajamas', en: 'pajamas', sp: 'la pijama', acceptable: ['la pijama', 'el pijama'] },
    { id: 'clothing-bathingsuit', en: 'swimsuit', sp: 'el traje de baño' },
    { id: 'clothing-shirt-long', en: 'long-sleeve shirt', sp: 'la camisa de manga larga' }
  ];

  const FOODS_POOL = [
    { id: 'foods-bread', en: 'bread', sp: 'el pan' },
    { id: 'foods-rice', en: 'rice', sp: 'el arroz' },
    { id: 'foods-chicken', en: 'chicken', sp: 'el pollo' },
    { id: 'foods-fish', en: 'fish', sp: 'el pescado' },
    { id: 'foods-egg', en: 'egg', sp: 'el huevo' },
    { id: 'foods-cheese', en: 'cheese', sp: 'el queso' },
    { id: 'foods-apple', en: 'apple', sp: 'la manzana' },
    { id: 'foods-banana', en: 'banana', sp: 'el plátano' },
    { id: 'foods-orange', en: 'orange', sp: 'la naranja' },
    { id: 'foods-milk', en: 'milk', sp: 'la leche' },
    { id: 'foods-water', en: 'water', sp: 'el agua' },
    { id: 'foods-beans', en: 'beans', sp: 'los frijoles' },
    { id: 'foods-beef', en: 'beef', sp: 'la carne de res' },
    { id: 'foods-pork', en: 'pork', sp: 'la carne de cerdo', acceptable: ['la carne de cerdo', 'el cerdo'] },
    { id: 'foods-turkey', en: 'turkey', sp: 'el pavo' },
    { id: 'foods-soup', en: 'soup', sp: 'la sopa' },
    { id: 'foods-salad', en: 'salad', sp: 'la ensalada' },
    { id: 'foods-potato', en: 'potato', sp: 'la papa' },
    { id: 'foods-tomato', en: 'tomato', sp: 'el tomate' },
    { id: 'foods-onion', en: 'onion', sp: 'la cebolla' },
    { id: 'foods-carrot', en: 'carrot', sp: 'la zanahoria' },
    { id: 'foods-strawberry', en: 'strawberry', sp: 'la fresa' },
    { id: 'foods-grapes', en: 'grapes', sp: 'las uvas' },
    { id: 'foods-breakfast', en: 'breakfast', sp: 'el desayuno' },
    { id: 'foods-lunch', en: 'lunch', sp: 'el almuerzo' },
    { id: 'foods-dinner', en: 'dinner', sp: 'la cena' },
    { id: 'foods-snack', en: 'snack', sp: 'la merienda' },
    { id: 'foods-juice', en: 'juice', sp: 'el jugo' },
    { id: 'foods-soda', en: 'soda', sp: 'el refresco' },
    { id: 'foods-tea', en: 'tea', sp: 'el té' },
    { id: 'foods-coffee', en: 'coffee', sp: 'el café' }
  ];

  const PRICES_POOL = [
    0.50, 0.75, 0.99, 1.00, 1.25, 1.50, 1.99, 2.08, 2.50, 2.75,
    3.40, 3.99, 4.25, 4.80, 5.00, 5.60, 6.60, 7.00, 7.45, 8.43,
    9.99, 10.00, 11.35, 12.50, 13.75, 14.20, 15.20, 16.99, 18.15, 19.50,
    20.00, 22.40, 25.99, 30.30, 33.80, 40.00, 47.30, 55.55, 68.90, 99.99
  ].map((amount, i) => ({ id: `price-${String(i + 1).padStart(2, '0')}`, amount }));

  const DATE_MONTHS = [
    { en: 'January', sp: 'enero' }, { en: 'February', sp: 'febrero' }, { en: 'March', sp: 'marzo' },
    { en: 'April', sp: 'abril' }, { en: 'May', sp: 'mayo' }, { en: 'June', sp: 'junio' },
    { en: 'July', sp: 'julio' }, { en: 'August', sp: 'agosto' }, { en: 'September', sp: 'septiembre' },
    { en: 'October', sp: 'octubre' }, { en: 'November', sp: 'noviembre' }, { en: 'December', sp: 'diciembre' }
  ];

  const DATES_POOL = [
    { id: 'date-jan-1', monthEn: 'January', monthSp: 'enero', day: 1 },
    { id: 'date-jan-9', monthEn: 'January', monthSp: 'enero', day: 9 },
    { id: 'date-feb-14', monthEn: 'February', monthSp: 'febrero', day: 14 },
    { id: 'date-feb-27', monthEn: 'February', monthSp: 'febrero', day: 27 },
    { id: 'date-mar-3', monthEn: 'March', monthSp: 'marzo', day: 3 },
    { id: 'date-mar-14', monthEn: 'March', monthSp: 'marzo', day: 14 },
    { id: 'date-apr-5', monthEn: 'April', monthSp: 'abril', day: 5 },
    { id: 'date-apr-18', monthEn: 'April', monthSp: 'abril', day: 18 },
    { id: 'date-may-2', monthEn: 'May', monthSp: 'mayo', day: 2 },
    { id: 'date-may-22', monthEn: 'May', monthSp: 'mayo', day: 22 },
    { id: 'date-jun-11', monthEn: 'June', monthSp: 'junio', day: 11 },
    { id: 'date-jun-30', monthEn: 'June', monthSp: 'junio', day: 30 },
    { id: 'date-jul-4', monthEn: 'July', monthSp: 'julio', day: 4 },
    { id: 'date-jul-16', monthEn: 'July', monthSp: 'julio', day: 16 },
    { id: 'date-aug-8', monthEn: 'August', monthSp: 'agosto', day: 8 },
    { id: 'date-aug-19', monthEn: 'August', monthSp: 'agosto', day: 19 },
    { id: 'date-sep-10', monthEn: 'September', monthSp: 'septiembre', day: 10 },
    { id: 'date-sep-28', monthEn: 'September', monthSp: 'septiembre', day: 28 },
    { id: 'date-oct-7', monthEn: 'October', monthSp: 'octubre', day: 7 },
    { id: 'date-oct-31', monthEn: 'October', monthSp: 'octubre', day: 31 },
    { id: 'date-nov-2', monthEn: 'November', monthSp: 'noviembre', day: 2 },
    { id: 'date-nov-15', monthEn: 'November', monthSp: 'noviembre', day: 15 },
    { id: 'date-dec-6', monthEn: 'December', monthSp: 'diciembre', day: 6 },
    { id: 'date-dec-25', monthEn: 'December', monthSp: 'diciembre', day: 25 }
  ];

  const SER_ESTAR_POOL = [
    { id: 'serestar-1', prompt: 'Ella ___ estudiante nueva.', expected: 'es', hint: 'She is a new student.' },
    { id: 'serestar-2', prompt: 'Nosotros ___ en la biblioteca ahora.', expected: 'estamos', hint: 'We are in the library now.' },
    { id: 'serestar-3', prompt: 'Tú ___ muy inteligente.', expected: 'eres', hint: 'You are very intelligent.' },
    { id: 'serestar-4', prompt: 'Mis amigos ___ cansados hoy.', expected: 'están', hint: 'My friends are tired today.' },
    { id: 'serestar-5', prompt: 'Yo ___ de California.', expected: 'soy', hint: 'I am from California.' },
    { id: 'serestar-6', prompt: 'La puerta ___ cerrada.', expected: 'está', hint: 'The door is closed.' },
    { id: 'serestar-7', prompt: 'Ustedes ___ muy puntuales.', expected: 'son', hint: 'You all are very punctual.' },
    { id: 'serestar-8', prompt: 'El examen ___ difícil.', expected: 'es', hint: 'The exam is difficult.' },
    { id: 'serestar-9', prompt: 'Nosotras ___ listas para salir.', expected: 'estamos', hint: 'We are ready to leave.' },
    { id: 'serestar-10', prompt: 'Mi hermano ___ en el gimnasio.', expected: 'está', hint: 'My brother is at the gym.' },
    { id: 'serestar-11', prompt: 'Ayer ellos ___ en casa.', expected: 'estuvieron', hint: 'Yesterday they were at home.' },
    { id: 'serestar-12', prompt: 'La clase de ayer ___ interesante.', expected: 'fue', hint: 'Yesterday’s class was interesting.' },
    { id: 'serestar-13', prompt: 'Cuando era niño, yo ___ muy tímido.', expected: 'era', hint: 'When I was a child, I was shy.' },
    { id: 'serestar-14', prompt: 'De pequeño, mi abuelo ___ fuerte.', expected: 'era', hint: 'As a child, my grandpa was strong.' },
    { id: 'serestar-15', prompt: 'Anoche tú ___ enfermo.', expected: 'estuviste', hint: 'Last night you were sick.' },
    { id: 'serestar-16', prompt: 'Ellas ___ de México.', expected: 'son', hint: 'They are from Mexico.' },
    { id: 'serestar-17', prompt: 'Mañana yo ___ en la oficina.', expected: 'estaré', hint: 'Tomorrow I will be in the office.' },
    { id: 'serestar-18', prompt: 'La película ___ aburrida.', expected: 'es', hint: 'The movie is boring.' },
    { id: 'serestar-19', prompt: 'Los libros ___ en la mesa.', expected: 'están', hint: 'The books are on the table.' },
    { id: 'serestar-20', prompt: 'Usted ___ muy amable.', expected: 'es', hint: 'You are very kind.' },
    { id: 'serestar-21', prompt: 'Nosotros ___ felices ayer.', expected: 'estuvimos', hint: 'We were happy yesterday.' },
    { id: 'serestar-22', prompt: 'Mi ciudad ___ grande.', expected: 'es', hint: 'My city is big.' },
    { id: 'serestar-23', prompt: 'En 2020, yo ___ estudiante.', expected: 'era', hint: 'In 2020, I was a student.' },
    { id: 'serestar-24', prompt: 'Ahora mismo ellos ___ ocupados.', expected: 'están', hint: 'Right now they are busy.' }
  ];

  const GUSTAR_POOL = [
    { id: 'gustar-1', prompt: 'I like apples.', expected: 'me gustan las manzanas' },
    { id: 'gustar-2', prompt: 'You like pizza.', expected: 'te gusta la pizza' },
    { id: 'gustar-3', prompt: 'She likes coffee.', expected: 'le gusta el café' },
    { id: 'gustar-4', prompt: 'We like to read.', expected: 'nos gusta leer' },
    { id: 'gustar-5', prompt: 'They like the classes.', expected: 'les gustan las clases' },
    { id: 'gustar-6', prompt: 'I like the blue shirt.', expected: 'me gusta la camisa azul' },
    { id: 'gustar-7', prompt: 'You all like soccer.', expected: 'les gusta el fútbol' },
    { id: 'gustar-8', prompt: 'He likes movies.', expected: 'le gustan las películas' },
    { id: 'gustar-9', prompt: 'We like math.', expected: 'nos gustan las matemáticas' },
    { id: 'gustar-10', prompt: 'I like to study Spanish.', expected: 'me gusta estudiar español' },
    { id: 'gustar-11', prompt: 'You like tacos.', expected: 'te gustan los tacos' },
    { id: 'gustar-12', prompt: 'She likes winter.', expected: 'le gusta el invierno' },
    { id: 'gustar-13', prompt: 'They like weekends.', expected: 'les gustan los fines de semana' },
    { id: 'gustar-14', prompt: 'We like our class.', expected: 'nos gusta nuestra clase' },
    { id: 'gustar-15', prompt: 'I like your shoes.', expected: 'me gustan tus zapatos' },
    { id: 'gustar-16', prompt: 'You (formal) like music.', expected: 'le gusta la música' },
    { id: 'gustar-17', prompt: 'My friends like history.', expected: 'les gusta la historia' },
    { id: 'gustar-18', prompt: 'I like books.', expected: 'me gustan los libros' },
    { id: 'gustar-19', prompt: 'We like to write.', expected: 'nos gusta escribir' },
    { id: 'gustar-20', prompt: 'They like the red backpacks.', expected: 'les gustan las mochilas rojas' }
  ];

  const PRESENT_PROGRESSIVE_POOL = [
    { id: 'prog-hablar-1s', subject: 'yo', infinitive: 'hablar', en: 'I am speaking' },
    { id: 'prog-comer-2s', subject: 'tú', infinitive: 'comer', en: 'You are eating' },
    { id: 'prog-vivir-3s', subject: 'él', infinitive: 'vivir', en: 'He is living' },
    { id: 'prog-estudiar-1p', subject: 'nosotros', infinitive: 'estudiar', en: 'We are studying' },
    { id: 'prog-correr-3p', subject: 'ellos', infinitive: 'correr', en: 'They are running' },
    { id: 'prog-leer-1s', subject: 'yo', infinitive: 'leer', en: 'I am reading' },
    { id: 'prog-oir-2s', subject: 'tú', infinitive: 'oír', en: 'You are hearing' },
    { id: 'prog-caer-3s', subject: 'ella', infinitive: 'caer', en: 'She is falling' },
    { id: 'prog-traer-1p', subject: 'nosotros', infinitive: 'traer', en: 'We are bringing' },
    { id: 'prog-construir-3p', subject: 'ellos', infinitive: 'construir', en: 'They are building' },
    { id: 'prog-dormir-1s', subject: 'yo', infinitive: 'dormir', en: 'I am sleeping' },
    { id: 'prog-pedir-2s', subject: 'tú', infinitive: 'pedir', en: 'You are asking for' },
    { id: 'prog-servir-3s', subject: 'usted', infinitive: 'servir', en: 'You are serving' },
    { id: 'prog-repetir-1p', subject: 'nosotros', infinitive: 'repetir', en: 'We are repeating' },
    { id: 'prog-decir-3p', subject: 'ellos', infinitive: 'decir', en: 'They are saying' },
    { id: 'prog-escribir-1s', subject: 'yo', infinitive: 'escribir', en: 'I am writing' },
    { id: 'prog-hacer-2s', subject: 'tú', infinitive: 'hacer', en: 'You are doing' },
    { id: 'prog-abrir-3s', subject: 'ella', infinitive: 'abrir', en: 'She is opening' },
    { id: 'prog-beber-1p', subject: 'nosotros', infinitive: 'beber', en: 'We are drinking' },
    { id: 'prog-salir-3p', subject: 'ellos', infinitive: 'salir', en: 'They are going out' }
  ];

  // --------------------------------------------
  // Conjugation helpers (Reflexive + Tenses)
  // --------------------------------------------
  const PRESENT_ENDINGS = {
    ar: ['o','as','a','amos','an'],
    er: ['o','es','e','emos','en'],
    ir: ['o','es','e','imos','en']
  };
  const PRETERITE_ENDINGS = {
    ar: ['é','aste','ó','amos','aron'],
    er: ['í','iste','ió','imos','ieron'],
    ir: ['í','iste','ió','imos','ieron']
  };
  const IMPERFECT_ENDINGS = {
    ar: ['aba','abas','aba','ábamos','aban'],
    er: ['ía','ías','ía','íamos','ían'],
    ir: ['ía','ías','ía','íamos','ían']
  };

  // Irregular full conjugation tables for reliability.
  const IRREGULAR = {
    present: {
      ser:    ['soy','eres','es','somos','son'],
      estar:  ['estoy','estás','está','estamos','están'],
      ir:     ['voy','vas','va','vamos','van'],
      tener:  ['tengo','tienes','tiene','tenemos','tienen'],
      venir:  ['vengo','vienes','viene','venimos','vienen'],
      decir:  ['digo','dices','dice','decimos','dicen'],
      hacer:  ['hago','haces','hace','hacemos','hacen'],
      poder:  ['puedo','puedes','puede','podemos','pueden'],
      poner:  ['pongo','pones','pone','ponemos','ponen'],
      saber:  ['sé','sabes','sabe','sabemos','saben'],
      ver:    ['veo','ves','ve','vemos','ven'],
      dar:    ['doy','das','da','damos','dan'],
      salir:  ['salgo','sales','sale','salimos','salen'],
      traer:  ['traigo','traes','trae','traemos','traen'],
      conocer:['conozco','conoces','conoce','conocemos','conocen'],
      conducir:['conduzco','conduces','conduce','conducimos','conducen'],
      traducir:['traduzco','traduces','traduce','traducimos','traducen'],
      producir:['produzco','produces','produce','producimos','producen'],
      caer:   ['caigo','caes','cae','caemos','caen'],
      oir:    ['oigo','oyes','oye','oímos','oyen'],
      haber:  ['he','has','ha','hemos','han'],
      caber:  ['quepo','cabes','cabe','cabemos','caben'],
      seguir: ['sigo','sigues','sigue','seguimos','siguen']
    },
    preterite: {
      ser:    ['fui','fuiste','fue','fuimos','fueron'],
      ir:     ['fui','fuiste','fue','fuimos','fueron'],
      tener:  ['tuve','tuviste','tuvo','tuvimos','tuvieron'],
      venir:  ['vine','viniste','vino','vinimos','vinieron'],
      estar:  ['estuve','estuviste','estuvo','estuvimos','estuvieron'],
      poder:  ['pude','pudiste','pudo','pudimos','pudieron'],
      poner:  ['puse','pusiste','puso','pusimos','pusieron'],
      saber:  ['supe','supiste','supo','supimos','supieron'],
      hacer:  ['hice','hiciste','hizo','hicimos','hicieron'],
      decir:  ['dije','dijiste','dijo','dijimos','dijeron'],
      traer:  ['traje','trajiste','trajo','trajimos','trajeron'],
      querer: ['quise','quisiste','quiso','quisimos','quisieron'],
      dar:    ['di','diste','dio','dimos','dieron'],
      ver:    ['vi','viste','vio','vimos','vieron'],
      andar:  ['anduve','anduviste','anduvo','anduvimos','anduvieron'],
      caber:  ['cupe','cupiste','cupo','cupimos','cupieron'],
      haber:  ['hube','hubiste','hubo','hubimos','hubieron'],
      conocer:['conocí','conociste','conoció','conocimos','conocieron'],
      conducir:['conduje','condujiste','condujo','condujimos','condujeron'],
      traducir:['traduje','tradujiste','tradujo','tradujimos','tradujeron'],
      producir:['produje','produjiste','produjo','produjimos','produjeron'],
      caer:   ['caí','caíste','cayó','caímos','cayeron'],
      oir:    ['oí','oíste','oyó','oímos','oyeron'],
      leer:   ['leí','leíste','leyó','leímos','leyeron']
    },
    imperfect: {
      ser: ['era','eras','era','éramos','eran'],
      ir:  ['iba','ibas','iba','íbamos','iban'],
      ver: ['veía','veías','veía','veíamos','veían']
    }
  };

  // Present stem-change patterns for regular-ish verbs (applies to 1s,2s,3s,3p).
  const STEM_CHANGE_PRESENT = {
    pensar: 'e>ie',
    querer: 'e>ie',
    empezar: 'e>ie',
    preferir: 'e>ie',
    sentir: 'e>ie',
    dormir: 'o>ue',
    acostar: 'o>ue',
    jugar: 'u>ue',
    pedir: 'e>i',
    repetir: 'e>i',
    servir: 'e>i',
    vestir: 'e>i',
    despertar: 'e>ie',
    cerrar: 'e>ie',
    comenzar: 'e>ie',
    entender: 'e>ie',
    volver: 'o>ue',
    encontrar: 'o>ue',
    poder: 'o>ue',
    mostrar: 'o>ue',
    almorzar: 'o>ue',
    seguir: 'e>i',
    conseguir: 'e>i'
  };

  // Preterite stem-change for some -ir verbs (only 3s and 3p).
  const STEM_CHANGE_PRETERITE_IR = {
    pedir: 'e>i',
    sentir: 'e>i',
    dormir: 'o>u',
    preferir: 'e>i',
    repetir: 'e>i',
    servir: 'e>i',
    seguir: 'e>i',
    vestir: 'e>i'
  };

  function stripDiacritics(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function cleanText(str) {
    const s = (str || '').trim();
    return s
      .replace(/^[\s\-–—•*()\[\]{}"'“”‘’.,;:!?¡¿]+/g, '')
      .replace(/[\s\-–—•*()\[\]{}"'“”‘’.,;:!?¡¿]+$/g, '')
      .trim();
  }

  function normalizeLoose(str) {
    // accent-insensitive, case-insensitive, trims, collapses whitespace
    const cleaned = cleanText(str).toLowerCase();
    const noDia = stripDiacritics(cleaned);
    return noDia.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeLooseWithTime(str) {
    return normalizeLoose(String(str || '').replace(/\bhrs?\b/g, '').replace(/\bh\b/g, ':'));
  }

  function removeLeadingArticles(norm) {
    const words = (norm || '').split(' ').filter(Boolean);
    while (words.length && LEADING_ARTICLES.includes(words[0])) words.shift();
    return words.join(' ');
  }

  function normalizeTimeToCanonical(input) {
    const raw = normalizeLooseWithTime(input);
    if (!raw) return null;
    if (raw === 'mediodia') return 'mediodia';
    if (raw === 'medianoche') return 'medianoche';

    const numeric = raw.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (numeric) {
      let h = parseInt(numeric[1], 10);
      let m = parseInt(numeric[2] || '0', 10);
      if (Number.isNaN(h) || Number.isNaN(m) || m < 0 || m > 59) return null;
      if (h === 24) h = 0;
      if (h > 12) h = h % 12;
      if (h === 0) h = 12;
      return `h${h}m${m}`;
    }

    let s = raw.replace(/^es la /, '').replace(/^son las /, '');
    s = s.replace(/^la /, '').replace(/^las /, '');
    s = s.replace(/^una$/, '1').replace(/^un$/, '1');
    s = s.replace(/\s+/g, ' ').trim();

    const wordToNum = {
      una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
      siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
      cuarto: 15, media: 30
    };
    if (/^\d+$/.test(s)) return `h${parseInt(s, 10)}m0`;

    const minusQuarter = s.match(/^(\w+)\s+menos\s+cuarto$/);
    if (minusQuarter && wordToNum[minusQuarter[1]]) {
      let h = wordToNum[minusQuarter[1]] - 1;
      if (h <= 0) h = 12;
      return `h${h}m45`;
    }

    const andPart = s.match(/^(\w+)\s+y\s+(\w+)(?:\s+y\s+(\w+))?$/);
    if (andPart && wordToNum[andPart[1]]) {
      const h = wordToNum[andPart[1]];
      if (andPart[2] === 'cuarto') return `h${h}m15`;
      if (andPart[2] === 'media') return `h${h}m30`;
      if (wordToNum[andPart[2]]) return `h${h}m${wordToNum[andPart[2]]}`;
      if (andPart[2] === 'treinta' && andPart[3] === 'cinco') return `h${h}m35`;
    }

    if (wordToNum[s]) return `h${wordToNum[s]}m0`;
    return null;
  }

  function buildTimeAcceptableSet(item) {
    const set = new Set();
    const hour12 = ((item.hour24 % 12) || 12);
    const minute = item.minute;
    const canonicalKey = normalizeTimeToCanonical(`${hour12}:${String(minute).padStart(2, '0')}`);
    if (canonicalKey) set.add(canonicalKey);

    if (item.hour24 === 12 && minute === 0) set.add('mediodia');
    if (item.hour24 === 0 && minute === 0) set.add('medianoche');

    set.add(normalizeTimeToCanonical(item.display));
    set.add(normalizeTimeToCanonical(removeLeadingArticles(normalizeLoose(item.display))));
    set.add(normalizeTimeToCanonical(`${hour12}:${String(minute).padStart(2, '0')}`));
    if (item.hour24 > 12) set.add(normalizeTimeToCanonical(`${item.hour24}:${String(minute).padStart(2, '0')}`));
    return new Set(Array.from(set).filter(Boolean));
  }

  function semanticDistractors(groupItems, correct, count = 3, mapper = (x) => x) {
    const out = [];
    for (const item of shuffle(groupItems)) {
      const value = mapper(item);
      if (value === correct) continue;
      if (out.includes(value)) continue;
      out.push(value);
      if (out.length >= count) break;
    }
    return out;
  }

  function generateRapidFireQuestion(app, moduleKey, pool) {
    const hidden = app.state.hiddenItems;
    const recent = new Set((app.recentByModule[moduleKey] || []).slice(-3));
    const available = pool.filter(x => !hidden[x.id] && !recent.has(x.id));
    const fallback = pool.filter(x => !hidden[x.id]);
    const item = pickByWeakScore(available.length ? available : fallback, app.state.itemScores, recent);
    if (!item) return null;
    return {
      module: moduleKey,
      id: item.id,
      mode: 'text',
      prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
      expectedDisplay: item.sp,
      acceptable: buildAcceptableAnswerSet(item.acceptable || [item.sp]),
      explanation: item.note || 'Common subject-pronoun and classroom-context variants are accepted.'
    };
  }

  function apocopateUno(nStr) {
    return String(nStr || '')
      .replace(/\bveintiuno\b/g, 'veintiún')
      .replace(/\by uno\b/g, 'y un')
      .replace(/\bciento uno\b/g, 'ciento un')
      .replace(/\buno\b/g, 'un');
  }

  function priceToSpanish(amount) {
    const dollars = Math.floor(amount);
    const cents = Math.round((amount - dollars) * 100);
    let dPart = '';
    let cPart = '';
    if (dollars > 0) {
      dPart = dollars === 1 ? 'un dólar' : `${apocopateUno(numberToSpanish(dollars))} dólares`;
    }
    if (cents > 0) {
      cPart = cents === 1 ? 'un centavo' : `${numberToSpanish(cents)} centavos`;
    }
    if (dPart && cPart) return `${dPart} con ${cPart}`;
    if (dPart) return dPart;
    if (cPart) return cPart;
    return 'cero dólares';
  }

  function buildPriceAcceptableSet(amount) {
    const canonical = priceToSpanish(amount);
    const set = buildAcceptableAnswerSet([canonical]);
    const dollars = Math.floor(amount);
    const cents = Math.round((amount - dollars) * 100);
    if (dollars > 0 && cents > 0) {
      const dPart = dollars === 1 ? 'un dólar' : `${apocopateUno(numberToSpanish(dollars))} dólares`;
      const cPart = cents === 1 ? 'un centavo' : `${numberToSpanish(cents)} centavos`;
      set.add(normalizeLoose(`${dPart} ${cPart}`));
    }
    return set;
  }

  function englishOrdinal(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n}st`;
    if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
    if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
    return `${n}th`;
  }

  function dateDayToSpanish(day) {
    return day === 1 ? 'primero' : numberToSpanish(day);
  }

  function fnv1a32(str) {
    // small, fast checksum for list versioning (NOT cryptographic)
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // 32-bit FNV-1a
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  function slugify(str) {
    const s = stripDiacritics((str || '').toLowerCase());
    const slug = s
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'item';
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickByWeakScore(arr, scoreMap, recencySet = new Set()) {
    if (!arr.length) return null;
    const practiceApp = scoreMap?.__practiceApp;
    if (practiceApp?.state?.settings?.prioritizeWeakQuestions) {
      const stats = practiceApp.state.userStats || {};
      const weights = arr.map((item) => {
        const history = stats[item.id];
        const attempts = Number(history?.attempts) || 0;
        const correct = Math.min(attempts, Number(history?.correct) || 0);
        const accuracy = attempts ? correct / attempts : 0.5;
        const evidence = Math.min(1, attempts / 5);
        const weakness = (1 - accuracy) * (0.65 + evidence * 0.35);
        const exploration = attempts ? 0.12 : 0.3;
        const recentPenalty = recencySet.has(item.id) ? 0.45 : 1;
        return Math.max(0.08, weakness + exploration) * recentPenalty;
      });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let random = Math.random() * total;
      for (let i = 0; i < arr.length; i++) {
        random -= weights[i];
        if (random <= 0) return arr[i];
      }
      return arr[arr.length - 1];
    }
    const weights = arr.map((item) => {
      const s = scoreMap[item.id] ?? 2;
      const weak = 1 + (5 - s);
      const recentPenalty = recencySet.has(item.id) ? 0.45 : 1;
      return weak * recentPenalty;
    });
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r <= 0) return arr[i];
    }
    return arr[arr.length - 1];
  }


  function personIndex(code) {
    return PERSONS.findIndex(p => p.code === code);
  }

  function applyStemChange(stem, pattern) {
    // Replace last occurrence of the "from" vowel in the stem.
    // This is a working heuristic for common Spanish stem-changers.
    if (!pattern) return stem;
    const [from, to] = pattern.split('>');
    const idx = stem.lastIndexOf(from);
    if (idx === -1) return stem;
    return stem.slice(0, idx) + to + stem.slice(idx + from.length);
  }

  function verbType(verb) {
    const v = stripDiacritics(verb.toLowerCase());
    if (v.endsWith('ar')) return 'ar';
    if (v.endsWith('er')) return 'er';
    if (v.endsWith('ir')) return 'ir';
    return null;
  }

  function conjugate(verb, tense, personCode) {
    const v = stripDiacritics(verb.toLowerCase());
    const idx = personIndex(personCode);
    if (idx < 0) return '';

    // Full irregular table wins.
    if (IRREGULAR[tense] && IRREGULAR[tense][v]) {
      return IRREGULAR[tense][v][idx];
    }

    const type = verbType(v);
    if (!type) return '';

    let stem = v.slice(0, -2);

    if (tense === 'present') {
      // present stem changes (except nosotros)
      const pattern = STEM_CHANGE_PRESENT[v];
      if (pattern && idx !== 3) stem = applyStemChange(stem, pattern);
      return stem + PRESENT_ENDINGS[type][idx];
    }

    if (tense === 'preterite') {
      // -car/-gar/-zar spelling changes in yo form
      if (idx === 0) {
        if (v.endsWith('car')) stem = stem.slice(0, -1) + 'qu';
        else if (v.endsWith('gar')) stem = stem.slice(0, -1) + 'gu';
        else if (v.endsWith('zar')) stem = stem.slice(0, -1) + 'c';
      }

      // i->y in 3rd person for verbs with vowel+er/ir (leer, oír, construir)
      const vPlain = stripDiacritics(v);
      const needsY = (idx === 2 || idx === 4) && (
        vPlain.endsWith('eer') || vPlain.endsWith('oir') || (vPlain.endsWith('uir') && !vPlain.endsWith('guir'))
      );

      // -ir stem changes in 3rd person (pidió, durmieron)
      if ((idx === 2 || idx === 4) && type === 'ir' && STEM_CHANGE_PRETERITE_IR[v]) {
        stem = applyStemChange(stem, STEM_CHANGE_PRETERITE_IR[v]);
      }

      const ending = PRETERITE_ENDINGS[type][idx];
      if (needsY) {
        // replace initial i in ending with y (ió → yó, ieron → yeron)
        if (idx === 2) return stem + 'yó';
        if (idx === 4) return stem + 'yeron';
      }
      return stem + ending;
    }

    if (tense === 'imperfect') {
      return stem + IMPERFECT_ENDINGS[type][idx];
    }

    return '';
  }

  function toSpanishGerund(infinitive) {
    const v = stripDiacritics(String(infinitive || '').toLowerCase());
    const irregular = {
      ir: 'yendo',
      poder: 'pudiendo',
      dormir: 'durmiendo',
      pedir: 'pidiendo',
      repetir: 'repitiendo',
      servir: 'sirviendo',
      decir: 'diciendo',
      venir: 'viniendo'
    };
    if (irregular[v]) return irregular[v];

    if (v.endsWith('ar')) return v.slice(0, -2) + 'ando';
    if (v.endsWith('er') || v.endsWith('ir')) {
      const stem = v.slice(0, -2);
      const endsWithVowel = /[aeiou]$/.test(stem);
      return stem + (endsWithVowel ? 'yendo' : 'iendo');
    }
    return v;
  }

  function subjectToPersonCode(subject) {
    const s = normalizeLoose(subject);
    if (s === 'yo') return '1s';
    if (s === 'tu') return '2s';
    if (s === 'el' || s === 'ella' || s === 'usted') return '3s';
    if (s === 'nosotros' || s === 'nosotras') return '1p';
    if (s === 'ellos' || s === 'ellas' || s === 'ustedes') return '3p';
    return '3s';
  }

  function isIrregularForTense(verb, tense) {
    const v = stripDiacritics(String(verb || '').toLowerCase());
    if (IRREGULAR[tense] && IRREGULAR[tense][v]) return true;
    if (tense === 'present' && STEM_CHANGE_PRESENT[v]) return true;
    if (tense === 'preterite' && STEM_CHANGE_PRETERITE_IR[v]) return true;
    return false;
  }

  // Reflexive pronouns for present tense.
  const REFLEXIVE_PRONOUN = {
    '1s': 'me',
    '2s': 'te',
    '3s': 'se',
    '1p': 'nos',
    '3p': 'se'
  };

  // --------------------------------------------
  // Command tone helpers
  // --------------------------------------------
  const COMMAND_IRREGULAR = {
    ser:    { usted: 'sea',      nosotros: 'seamos' },
    ir:     { usted: 'vaya',     nosotros: 'vayamos' },
    estar:  { usted: 'esté',     nosotros: 'estemos' },
    dar:    { usted: 'dé',       nosotros: 'demos' },
    saber:  { usted: 'sepa',     nosotros: 'sepamos' },
    tener:  { usted: 'tenga',    nosotros: 'tengamos' },
    venir:  { usted: 'venga',    nosotros: 'vengamos' },
    decir:  { usted: 'diga',     nosotros: 'digamos' },
    hacer:  { usted: 'haga',     nosotros: 'hagamos' },
    poner:  { usted: 'ponga',    nosotros: 'pongamos' },
    salir:  { usted: 'salga',    nosotros: 'salgamos' },
    traer:  { usted: 'traiga',   nosotros: 'traigamos' }
  };

  function commandForm(verb, form /* 'usted'|'nosotros' */) {
    const v = stripDiacritics(verb.toLowerCase());
    if (COMMAND_IRREGULAR[v]) return COMMAND_IRREGULAR[v][form];

    const type = verbType(v);
    if (!type) return '';

    let stem = v.slice(0, -2);

    // orthographic changes to keep pronunciation
    if (type === 'ar') {
      if (v.endsWith('car')) stem = stem.slice(0, -1) + 'qu';
      else if (v.endsWith('gar')) stem = stem.slice(0, -1) + 'gu';
      else if (v.endsWith('zar')) stem = stem.slice(0, -1) + 'c';
    } else {
      if (v.endsWith('ger') || v.endsWith('gir')) stem = stem.slice(0, -1) + 'j';
      if (v.endsWith('guir')) stem = stem.slice(0, -1); // drop the u (distinguIR → distinga)
    }

    // "flip the vowel" rule:
    // -ar → -e / -emos
    // -er/-ir → -a / -amos
    if (form === 'usted') {
      return stem + (type === 'ar' ? 'e' : 'a');
    }
    // nosotros
    return stem + (type === 'ar' ? 'emos' : 'amos');
  }

  // --------------------------------------------
  // Vocab parsing
  // --------------------------------------------
  function tokenizeEnglish(enNorm) {
    // Split punctuation; treat hyphen as separator (one-hundred → one, hundred)
    const cleaned = enNorm.replace(/[^a-z0-9\-\s]/g, ' ');
    const raw = cleaned.split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of raw) {
      if (t.includes('-')) out.push(...t.split('-').filter(Boolean));
      else out.push(t);
    }
    return out;
  }

  function isPureNumberVocab(sp, en) {
    // Exclude only cards that are essentially "just a number" (digits or number words) on BOTH sides.
    // This intentionally keeps phrases like "Es la una" / "It's one o'clock".
    const spC = cleanText(sp);
    const enC = cleanText(en);

    if (/^\d+$/.test(spC) || /^\d+$/.test(enC)) return true;

    const spNorm = stripDiacritics(spC.toLowerCase());
    const enNorm = stripDiacritics(enC.toLowerCase());

    const spTokens = spNorm.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).filter(t => t !== 'y');
    const enTokens = tokenizeEnglish(enNorm).filter(t => t !== 'and');

    if (!spTokens.length || !enTokens.length) return false;

    const spIsNumeric = spTokens.every(t => ES_NUMERIC.has(t) || /^\d+$/.test(t));
    const enIsNumeric = enTokens.every(t => EN_NUMERIC.has(t) || /^\d+$/.test(t));

    return spIsNumeric && enIsNumeric;
  }

  function expandSlashVariants(spanish) {
    // Expands tokens like "él/Ella/Usted es" into ["él es", "Ella es", "Usted es"]
    const tokens = spanish.split(/\s+/).filter(Boolean);
    let variants = [''];

    for (const tok of tokens) {
      let options = [tok];

      if (tok.includes('/')) {
        // Gender shorthand: rojo/a -> rojo, roja
        if (/o\/?a$/i.test(tok)) {
          options = [tok.replace(/o\/?a$/i, 'o'), tok.replace(/o\/?a$/i, 'a')];
        } else {
          options = tok.split('/').filter(Boolean);
        }
      }

      const next = [];
      for (const prefix of variants) {
        for (const opt of options) {
          next.push((prefix ? prefix + ' ' : '') + opt);
        }
      }
      variants = next;
    }

    return Array.from(new Set(variants.map(v => v.trim()).filter(Boolean)));
  }

  function buildAcceptableAnswerSet(baseAnswers) {
    // Build a set of normalized acceptable answers, with optional stripping of leading articles/subjects
    // ONLY for multi-word answers (prevents pronouns like "Yo" from becoming empty).
    const set = new Set();

    for (const ans of baseAnswers) {
      const cleaned = cleanText(ans);
      if (!cleaned) continue;

      const norm = normalizeLoose(cleaned);
      if (norm) set.add(norm);

      const words = norm.split(' ').filter(Boolean);
      if (words.length >= 2) {
        // Strip leading articles
        let w = [...words];
        while (w.length && LEADING_ARTICLES.includes(w[0])) w.shift();
        const normNoArt = w.join(' ').trim();
        if (normNoArt) set.add(normNoArt);

        // Strip leading subject pronouns
        w = [...words];
        while (w.length && LEADING_SUBJECTS.includes(w[0])) w.shift();
        const normNoSubj = w.join(' ').trim();
        if (normNoSubj) set.add(normNoSubj);

        // Strip both (subject then article)
        w = [...words];
        while (w.length && LEADING_SUBJECTS.includes(w[0])) w.shift();
        while (w.length && LEADING_ARTICLES.includes(w[0])) w.shift();
        const normNoBoth = w.join(' ').trim();
        if (normNoBoth) set.add(normNoBoth);
      }
    }

    return set;
  }

  function parseQuizletBlock(block) {
    const entries = [];
    const usedIds = new Map(); // slug -> count for stable de-duping
    const lines = String(block || '')
      .split(/\n/)
      .map((l) => cleanText(l))
      .filter(Boolean);
    const overlapSet = buildVocabDomainOverlapSet();

    for (let i = 0; i < lines.length - 1; i += 2) {
      const sp = lines[i];
      const en = lines[i + 1];

      try {
        // Filter only "pure number" entries (see user clarification).
        if (isPureNumberVocab(sp, en)) continue;
        const variants = expandSlashVariants(sp);
        if (isDedicatedModuleOverlap(sp, variants, overlapSet)) continue;

        const baseSlug = slugify(sp);
        const count = (usedIds.get(baseSlug) || 0) + 1;
        usedIds.set(baseSlug, count);

        const idSlug = count === 1 ? baseSlug : (baseSlug + '-' + count);
        const id = 'vocab-' + idSlug;

        const acceptable = buildAcceptableAnswerSet(variants);

        const L_sp = sp.length;
        const L_en = en.length;
        const numWords = sp.trim().split(/\s+/).filter(Boolean).length;
        const hasAccent = /[áéíóúñüÁÉÍÓÚÑÜ]/.test(sp) ? 1 : 0;
        const longWordBonus = (L_sp >= 8) ? 1 : 0;

        const S = L_sp + L_en + (4 * numWords) + (5 * hasAccent) + (3 * longWordBonus);

        entries.push({
          id,
          sp,
          en,
          variants,
          acceptable, // Set of normalized acceptable answers
          complexityRaw: S,
          complexityNorm: 0 // computed later
        });
      } catch (err) {
        // Required defensive behavior: log raw lines and skip.
        console.warn('Failed parsing vocab pair.', { sp, en }, 'Error:', err);
      }
    }

    // Normalize complexity
    const scores = entries.map(e => e.complexityRaw);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    for (const e of entries) {
      if (maxS === minS) e.complexityNorm = 0.5;
      else e.complexityNorm = (e.complexityRaw - minS) / (maxS - minS);
    }

    return entries;
  }

  function buildVocabDomainOverlapSet() {
    const set = new Set();
    const add = (value) => {
      const norm = normalizeLoose(value);
      if (norm) set.add(norm);
    };
    const addPool = (pool, key = 'sp') => {
      for (const item of pool) {
        const raw = item && item[key] ? cleanText(item[key]) : '';
        if (!raw) continue;
        add(raw);
        const noArticle = removeLeadingArticles(normalizeLoose(raw));
        if (noArticle) set.add(noArticle);
        for (const v of expandSlashVariants(raw)) {
          add(v);
          const vNoArt = removeLeadingArticles(normalizeLoose(v));
          if (vNoArt) set.add(vNoArt);
        }
      }
    };

    addPool(DAYS_POOL);
    addPool(MONTHS_POOL);
    addPool(SEASONS_POOL);
    addPool(COLORS_POOL);
    addPool(WEATHER_POOL);
    addPool(CLOTHING_POOL);
    addPool(FOODS_POOL);

    for (const t of TIME_POOL) {
      add(t.display);
      const canon = normalizeTimeToCanonical(t.display);
      if (canon) set.add(canon);
    }
    for (const d of DATES_POOL) {
      add(`el ${dateDayToSpanish(d.day)} de ${d.monthSp}`);
      if (d.day === 1) add(`el uno de ${d.monthSp}`);
    }

    // Common time/date tokens covered by dedicated modules.
    ['media', 'cuarto', 'mediodia', 'medianoche', 'el dia', 'el mes', 'la semana', 'la hora', 'la fecha'].forEach(add);

    return set;
  }

  function isDedicatedModuleOverlap(sp, variants, overlapSet) {
    const forms = [sp, ...(variants || [])];
    for (const form of forms) {
      const norm = normalizeLoose(form);
      if (!norm) continue;
      const noArt = removeLeadingArticles(norm);

      if (overlapSet.has(norm) || (noArt && overlapSet.has(noArt))) return true;

      // Time phrases are handled by the dedicated Time module.
      if (normalizeTimeToCanonical(form) != null) return true;
    }
    return false;
  }

  // --------------------------------------------
  // App state + persistence
  // --------------------------------------------
  function defaultState() {
    return {
      version: APP_VERSION,
      settings: {
        modulesEnabled: {
          numbers: true,
          commands: false,
          vocab: false,
          mayo_madness_1: false,
          mayo_madness_2: false,
          rapid_translations_2: false,
          rapid_regular_verbs: false,
          rapid_irregular_verbs: false,
          mayo_madness_3_rapid_translations: false,
          reflexive: false,
          tenses: false,
          days: true,
          months: true,
          seasons: true,
          time: true,
          colors: true,
          prices: false,
          weather: false,
          clothing: false,
          foods: false,
          present_progressive: false,
          ser_estar: false,
          gustar: false,
          dates: false,
          summer_time_words: false,
          summer_preterite: false,
          summer_imperfect: false,
          summer_irregular_preterite: false,
          summer_irregular_imperfect: false,
          summer_tense_choice: false,
          summer_translations: false,
          honors_ordinal_numbers: false,
          honors_test1_review: false
        },
        mayoMadnessEnabled: true,
        tensesEnabled: { present: true, preterite: false, imperfect: false },
        tensesIrregularOnly: false,
        numbersMin: 1,
        numbersMax: 1000,
        numbersRequireTyping: false,
        numbersSequential: false,
        vocabMode: 'weighted',
        prioritizeWeakQuestions: true,
        firstRunSeen: false,
        showKeyHintStrip: false
      },
      hiddenItems: {},
      hiddenQuestions: {},
      itemScores: {},
      answerHistory: {},
      moduleChoices: { practiceMix: 50, showKeyHintStrip: false, newModulesAnswerMode: 'spelling' },
      vocabChecksum: '',
      userStats: {},
      profileId: '',
      analyticsVersion: ANALYTICS_VERSION,
      practiceSessions: [],
      lifetimeStats: { answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 }
      ,lastLevel: 'spanish1'
      ,lastModule: null
    };
  }

  function isPlainObject(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x);
  }

  function sanitizeState(raw) {
    const base = defaultState();
    if (!isPlainObject(raw)) return base;

    const out = { ...base };

    out.version = APP_VERSION;

    // Settings
    if (isPlainObject(raw.settings)) {
      const s = raw.settings;

      if (isPlainObject(s.modulesEnabled)) {
        for (const m of Object.keys(base.settings.modulesEnabled)) {
          out.settings.modulesEnabled[m] = !!s.modulesEnabled[m];
        }
        if (s.modulesEnabled.ser_estar_gustar === true) {
          if (!('ser_estar' in s.modulesEnabled)) out.settings.modulesEnabled.ser_estar = true;
          if (!('gustar' in s.modulesEnabled)) out.settings.modulesEnabled.gustar = true;
        }
      }
      if (typeof s.mayoMadnessEnabled === 'boolean') {
        out.settings.mayoMadnessEnabled = s.mayoMadnessEnabled;
      }
      if (isPlainObject(s.tensesEnabled)) {
        for (const t of Object.keys(base.settings.tensesEnabled)) {
          out.settings.tensesEnabled[t] = !!s.tensesEnabled[t];
        }
      }
      if (typeof s.tensesIrregularOnly === 'boolean') out.settings.tensesIrregularOnly = s.tensesIrregularOnly;
      const numberRange = normalizeNumberRange(s.numbersMin ?? base.settings.numbersMin, s.numbersMax ?? base.settings.numbersMax);
      out.settings.numbersMin = numberRange.min;
      out.settings.numbersMax = numberRange.max;
      if (typeof s.numbersRequireTyping === 'boolean') out.settings.numbersRequireTyping = s.numbersRequireTyping;
      if (typeof s.numbersSequential === 'boolean') out.settings.numbersSequential = s.numbersSequential;
      if (s.vocabMode === 'uniform' || s.vocabMode === 'weighted') out.settings.vocabMode = s.vocabMode;
      if (typeof s.prioritizeWeakQuestions === 'boolean') out.settings.prioritizeWeakQuestions = s.prioritizeWeakQuestions;
      if (typeof s.firstRunSeen === 'boolean') out.settings.firstRunSeen = s.firstRunSeen;
      if (typeof s.showKeyHintStrip === 'boolean') out.settings.showKeyHintStrip = s.showKeyHintStrip;
    }

    // Hidden questions/items
    const hiddenRaw = isPlainObject(raw.hiddenItems) ? raw.hiddenItems : raw.hiddenQuestions;
    if (isPlainObject(hiddenRaw)) {
      out.hiddenItems = {};
      for (const [k, v] of Object.entries(hiddenRaw)) {
        if (typeof k === 'string' && v) out.hiddenItems[k] = true;
      }
    }
    out.hiddenQuestions = { ...out.hiddenItems };

    if (isPlainObject(raw.itemScores)) {
      out.itemScores = {};
      for (const [k, v] of Object.entries(raw.itemScores)) {
        const n = Number(v);
        if (typeof k === 'string' && Number.isFinite(n)) out.itemScores[k] = Math.max(0, Math.min(5, Math.round(n)));
      }
    }

    if (isPlainObject(raw.answerHistory)) {
      out.answerHistory = {};
      for (const [id, history] of Object.entries(raw.answerHistory)) {
        if (!isPlainObject(history)) continue;
        out.answerHistory[id] = {
          recent: Array.isArray(history.recent) ? history.recent.filter(x => typeof x === 'string').slice(-8) : [],
          answers: isPlainObject(history.answers) ? history.answers : {}
        };
      }
    }

    if (isPlainObject(raw.moduleChoices)) {
      const p = Number(raw.moduleChoices.practiceMix);
      if (Number.isFinite(p)) out.moduleChoices.practiceMix = Math.max(0, Math.min(100, Math.round(p)));
      if (typeof raw.moduleChoices.showKeyHintStrip === 'boolean') out.moduleChoices.showKeyHintStrip = raw.moduleChoices.showKeyHintStrip;
      if (raw.moduleChoices.newModulesAnswerMode === 'spelling' || raw.moduleChoices.newModulesAnswerMode === 'mixed') {
        out.moduleChoices.newModulesAnswerMode = raw.moduleChoices.newModulesAnswerMode;
      }
    }

    // Checksum + stats (optional)
    if (typeof raw.vocabChecksum === 'string') out.vocabChecksum = raw.vocabChecksum;

    if (isPlainObject(raw.userStats)) {
      out.userStats = {};
      for (const [id, st] of Object.entries(raw.userStats)) {
        if (!isPlainObject(st)) continue;
        const attempts = Number.isFinite(st.attempts) ? st.attempts : parseInt(st.attempts, 10);
        const correct = Number.isFinite(st.correct) ? st.correct : parseInt(st.correct, 10);
        out.userStats[id] = {
          attempts: Number.isFinite(attempts) ? attempts : 0,
          correct: Number.isFinite(correct) ? correct : 0
        };
      }
    }

    if (typeof raw.profileId === 'string') out.profileId = raw.profileId.slice(0, 120);
    if (raw.lastLevel === 'spanish1' || raw.lastLevel === 'spanish2') out.lastLevel = raw.lastLevel;
    if (typeof raw.lastModule === 'string' && raw.lastModule.length <= 80) out.lastModule = raw.lastModule;
    if (Number(raw.analyticsVersion) === ANALYTICS_VERSION && Array.isArray(raw.practiceSessions)) {
      out.practiceSessions = raw.practiceSessions.slice(-50).map((session) => ({
        id: String(session?.id || '').slice(0, 80),
        level: session?.level === 'spanish2' ? 'spanish2' : 'spanish1',
        startedAt: String(session?.startedAt || '').slice(0, 40),
        endedAt: String(session?.endedAt || '').slice(0, 40),
        durationSeconds: Math.max(0, Number(session?.durationSeconds) || 0),
        answered: Math.max(0, Number(session?.answered) || 0),
        correct: Math.max(0, Number(session?.correct) || 0),
        incorrect: Math.max(0, Number(session?.incorrect) || 0),
        bestStreak: Math.max(0, Number(session?.bestStreak) || 0),
        modules: Array.isArray(session?.modules) ? session.modules.map((m) => String(m).slice(0, 80)).slice(0, 30) : []
      })).filter((session) => session.id && session.startedAt);
    }
    if (Number(raw.analyticsVersion) === ANALYTICS_VERSION && isPlainObject(raw.lifetimeStats)) {
      out.lifetimeStats = {
        answered: Math.max(0, Number(raw.lifetimeStats.answered) || 0),
        correct: Math.max(0, Number(raw.lifetimeStats.correct) || 0),
        currentStreak: Math.max(0, Number(raw.lifetimeStats.currentStreak) || 0),
        bestStreak: Math.max(0, Number(raw.lifetimeStats.bestStreak) || 0)
      };
    }

    // Analytics intentionally start fresh after the first implementation and
    // remain independent from older per-item learning statistics.
    if (Number(raw.analyticsVersion) !== ANALYTICS_VERSION) {
      out.analyticsVersion = ANALYTICS_VERSION;
      out.practiceSessions = [];
      out.lifetimeStats = { answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
    }

    return out;
  }

  let memoryState = defaultState();
  let storageBlocked = false;

  function getState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitizeState(JSON.parse(raw));
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) return sanitizeState(JSON.parse(legacy));
      return defaultState();
    } catch (err) {
      storageBlocked = true;
      console.warn('Failed to load state; using memory fallback.', err);
      return sanitizeState(memoryState);
    }
  }

  function saveState(state) {
    try {
      const payload = { ...state, hiddenItems: state.hiddenItems || state.hiddenQuestions || {} };
      payload.hiddenQuestions = { ...payload.hiddenItems };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      memoryState = sanitizeState(payload);
      storageBlocked = false;
    } catch (err) {
      storageBlocked = true;
      memoryState = sanitizeState(state);
      console.error('Failed to save state; using memory fallback:', err);
    }
  }

  function createProfileId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function readProfileId() {
    try {
      const stored = localStorage.getItem('claro_profile_id');
      if (stored) return stored;
    } catch (_) {}
    try {
      const cookie = document.cookie.split('; ').find((part) => part.startsWith(`${PROFILE_COOKIE_KEY}=`));
      if (cookie) return decodeURIComponent(cookie.slice(PROFILE_COOKIE_KEY.length + 1));
    } catch (_) {}
    return '';
  }

  function persistProfileId(profileId) {
    try { localStorage.setItem('claro_profile_id', profileId); } catch (_) {}
    try { document.cookie = `${PROFILE_COOKIE_KEY}=${encodeURIComponent(profileId)}; max-age=31536000; path=/; SameSite=Lax`; } catch (_) {}
  }

  function readLastViewCookie() {
    try {
      const part = document.cookie.split('; ').find((item) => item.startsWith('claro_last_view='));
      return part ? JSON.parse(decodeURIComponent(part.slice('claro_last_view='.length))) : null;
    } catch (_) { return null; }
  }

  function persistLastView(view) {
    try {
      document.cookie = `claro_last_view=${encodeURIComponent(JSON.stringify(view))}; max-age=31536000; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  // --------------------------------------------
  // Pools for modules (finite IDs for hiding)
  // --------------------------------------------
  const COMMAND_VERBS = [
    // regular-ish
    'hablar','comer','vivir','mirar','escuchar','leer','correr','vender','llegar','buscar','trabajar',
    'caminar','estudiar','aprender','abrir','escribir','beber','compartir','preguntar','explicar','practicar',
    // irregular/common
    'tener','venir','decir','hacer','poner','salir','ir','ser','estar','dar','saber','traer','pedir','dormir'
  ];

  const DIRECT_OBJECT_PRONOUNS = ['lo','la','los','las','me','te','nos'];

  const REFLEXIVE_VERBS = [
    'llamarse','levantarse','acostarse','ducharse','peinarse','lavarse','vestirse','sentirse','ponerse','irse','despertarse',
    'maquillarse','afeitarse','prepararse','cepillarse','quitarse','sentarse','dormirse','divertirse','bañarse','secarse',
    'relajarse','reunirse','enojarse','quedarse','moverse'
  ];

  const TENSE_VERBS = [
    // Mix of common regular + irregular (engine supports these)
    'hablar','comer','vivir',
    'ser','estar','ir',
    'tener','venir','decir','hacer','poner','poder','saber','ver','dar','salir','traer','querer',
    'andar','caber','haber','conducir','traducir','producir','conocer','caer','oír','leer',
    'llegar','buscar','jugar','dormir','pedir','sentir','preferir','repetir','servir','vestir',
    'pensar','empezar','acostar','despertar','seguir'
  ];

  // Spanish 2 Honors summer-prep content from the supplied summer assignment.
  const SUMMER_TIME_WORDS_POOL = [
    ['ayer','yesterday'], ['anoche','last night'], ['la semana pasada','last week'], ['el mes pasado','last month'],
    ['esta mañana','this morning'], ['siempre','always'], ['casi siempre','almost always'], ['normalmente','normally'],
    ['de vez en cuando','every now and then'], ['frecuentemente','frequently'], ['el verano pasado','last summer'],
    ['cuando era un niño','when I was a kid'], ['cuando tenía quince años','when I was 15 years old'], ['cuando vivía en…','when I lived in…'],
    ['anteayer','the day before yesterday'], ['anteanoche','the night before last'], ['hace tres días','three days ago'],
    ['por lo general','normally, generally'], ['era costumbre que…','it was normal for…'], ['ayer por la tarde','yesterday afternoon'],
    ['una vez','one time'], ['el otro día','the other day'], ['en febrero','in February'], ['por fin','finally'],
    ['un día por mes','one day per month'], ['constantemente','constantly'], ['todos los días','every day'],
    ['cada día','each day'], ['de costumbre','normally'], ['a menudo','often'], ['a veces','sometimes'],
    ['con frecuencia','frequently'], ['de repente','all of a sudden']
  ].map(([sp, en], index) => ({ id: `summer-time-${index + 1}`, sp, en }));

  const SUMMER_PRETERITE_VERBS = ['hablar','comer','vivir','trabajar','estudiar','beber','escribir','mirar','correr','vender'];
  const SUMMER_IMPERFECT_VERBS = ['hablar','comer','vivir','trabajar','estudiar','beber','escribir','mirar','correr','vender'];
  const SUMMER_IRREGULAR_VERBS = [
    ['saber','to know / find out'], ['tener','to have'], ['estar','to be'], ['dar','to give'], ['ver','to see'],
    ['poder','to be able to'], ['ser','to be'], ['ir','to go'], ['decir','to say / tell'], ['querer','to want / love'],
    ['hacer','to do / make'], ['venir','to come'], ['traer','to bring'], ['leer','to read'], ['oír','to hear'],
    ['sacar','to take out'], ['llegar','to arrive'], ['comenzar','to start']
  ];

  function buildSummerConjugationPool(prefix, verbs, tense) {
    return verbs.flatMap((verb) => PERSONS.map((person) => ({
      id: `${prefix}-${verb}-${person.code}`,
      verb,
      person: person.code,
      tense
    })));
  }

  const SUMMER_PRETERITE_POOL = buildSummerConjugationPool('summer-preterite', SUMMER_PRETERITE_VERBS, 'preterite');
  const SUMMER_IMPERFECT_POOL = buildSummerConjugationPool('summer-imperfect', SUMMER_IMPERFECT_VERBS, 'imperfect');
  const SUMMER_IRREGULAR_PRETERITE_POOL = SUMMER_IRREGULAR_VERBS.flatMap(([verb, en]) => PERSONS.map((person) => ({
    id: `summer-irregular-${verb}-${person.code}`,
    verb,
    en,
    person: person.code,
    tense: 'preterite'
  }))).concat(
    ['poder', 'querer'].flatMap((verb) => PERSONS.map((person) => ({
      id: `summer-irregular-no-${verb}-${person.code}`,
      verb,
      displayVerb: `no ${verb}`,
      prefix: 'no ',
      en: `not to ${verb === 'poder' ? 'be able to' : 'want'}`,
      person: person.code,
      tense: 'preterite'
    })))
  );
  const SUMMER_IRREGULAR_IMPERFECT_POOL = buildSummerConjugationPool('summer-irregular-imperfect', ['ser', 'ir', 'ver'], 'imperfect');

  // Spanish 2 Honors content stays isolated from Spanish 1 and the existing
  // Summer Prep modules, but uses the same hidden-item and scoring framework.
  const ORDINALS = [
    [1, 'primero', 'primera', 'first'], [2, 'segundo', 'segunda', 'second'],
    [3, 'tercero', 'tercera', 'third'], [4, 'cuarto', 'cuarta', 'fourth'],
    [5, 'quinto', 'quinta', 'fifth'], [6, 'sexto', 'sexta', 'sixth'],
    [7, 'séptimo', 'séptima', 'seventh'], [8, 'octavo', 'octava', 'eighth'],
    [9, 'noveno', 'novena', 'ninth'], [10, 'décimo', 'décima', 'tenth']
  ];
  const ORDINAL_EN = { first: ['first'], second: ['second'], third: ['third'], fourth: ['fourth'], fifth: ['fifth'], sixth: ['sixth'], seventh: ['seventh'], eighth: ['eighth', '8th'], ninth: ['ninth'], tenth: ['tenth'] };
  const ORDINAL_POOL = ORDINALS.flatMap(([number, masc, fem, en]) => [
    { id: `ordinal-en-${number}`, prompt: `Translate <strong>“${en}”</strong> into Spanish.`, expectedDisplay: masc, acceptable: [masc, fem], explanation: 'With no noun, the masculine form is the default. A feminine form is also accepted when appropriate.' },
    { id: `ordinal-number-${number}`, prompt: `Translate <strong>“${number}th”</strong> into Spanish.`, expectedDisplay: masc, acceptable: [masc, fem] },
    { id: `ordinal-context-f-${number}`, prompt: `Translate <strong>“the ${en} page”</strong>. Complete: <strong>la ___ página</strong>`, expectedDisplay: fem, acceptable: [fem], explanation: 'La página is feminine, so the ordinal must be feminine.' },
    { id: `ordinal-context-m-${number}`, prompt: `Translate <strong>“the ${en} chapter”</strong>. Complete: <strong>el ___ capítulo</strong>`, expectedDisplay: number === 1 ? 'primer' : number === 3 ? 'tercer' : masc, acceptable: [number === 1 ? 'primer' : number === 3 ? 'tercer' : masc], explanation: number === 1 || number === 3 ? 'Primero becomes primer and tercero becomes tercer before a masculine singular noun.' : 'El capítulo is masculine, so the ordinal must be masculine.' }
  ]);
  const HONORS_TIME_WORDS = [
    ['ayer', ['yesterday']], ['anoche', ['last night']], ['la semana pasada', ['last week']], ['el mes pasado', ['last month']],
    ['esta mañana', ['this morning']], ['siempre', ['always']], ['casi siempre', ['almost always']], ['normalmente', ['normally', 'usually']],
    ['de vez en cuando', ['every now and then', 'from time to time']], ['frecuentemente', ['frequently', 'often']], ['el verano pasado', ['last summer']],
    ['cuando era un niño', ['when I was a kid', 'when I was a child']], ['cuando tenía quince años', ['when I was 15 years old', 'when I was fifteen years old']],
    ['cuando vivía en…', ['when I lived in']], ['anteayer', ['the day before yesterday']], ['anteanoche', ['the night before last']],
    ['hace tres días', ['three days ago']], ['por lo general', ['normally', 'generally']], ['era costumbre que…', ['it was customary for', 'it was normal for']],
    ['ayer por la tarde', ['yesterday afternoon']], ['ayer por la noche', ['yesterday evening', 'last night']], ['ayer por la mañana', ['yesterday morning']],
    ['una vez', ['once', 'one time']], ['el otro día', ['the other day']], ['en febrero', ['in February']], ['por fin', ['finally']],
    ['un día por mes', ['one day per month']], ['constantemente', ['constantly']], ['todos los días', ['every day']], ['cada día', ['every day', 'each day']],
    ['de costumbre', ['normally', 'as usual']], ['a menudo', ['often']], ['a veces', ['sometimes']], ['con frecuencia', ['frequently', 'often']],
    ['de repente', ['suddenly', 'all of a sudden']]
  ].map(([sp, en], index) => ({ id: `honors-time-${index + 1}`, sp, en }));
  const HONORS_PERSONS_BY_CODE = Object.fromEntries(HONORS_PERSONS.map((person) => [person.code, person]));
  const HONORS_PRETERITE_VERBS = ['hablar','estudiar','trabajar','caminar','mirar','bailar','comprar','comer','beber','aprender','correr','vender','vivir','escribir','recibir','decidir','abrir','asistir'];
  const HONORS_IMPERFECT_VERBS = [...HONORS_PRETERITE_VERBS];
  const HONORS_CHOICE_POOL = [
    ['Cuando era niño, ___ al parque todos los días.', 'caminar', '1s', 'imperfect', 'habitual past action'],
    ['Ayer ___ mi tarea después de cenar.', 'terminar', '1s', 'preterite', 'completed action with ayer'],
    ['Mientras estudiábamos, ___ la música.', 'escuchar', '1p', 'imperfect', 'background action'],
    ['De repente, ___ la puerta.', 'abrir', '3s', 'preterite', 'sudden completed action'],
    ['El verano pasado ___ en México.', 'vivir', '1p', 'preterite', 'completed time period'],
    ['Normalmente ___ a las siete.', 'trabajar', '1s', 'imperfect', 'habitual action']
  ].map(([sentence, verb, person, tense, clue], index) => ({ id: `honors-choice-${index + 1}`, sentence, verb, person, tense, clue }));

  function honorsRegularConjugate(verb, tense, code) {
    const type = verbType(verb);
    const stem = stripDiacritics(verb).slice(0, -2);
    const endings = {
      preterite: { ar: ['é','aste','ó','amos','asteis','aron'], er: ['í','iste','ió','imos','isteis','ieron'], ir: ['í','iste','ió','imos','isteis','ieron'] },
      imperfect: { ar: ['aba','abas','aba','ábamos','abais','aban'], er: ['ía','ías','ía','íamos','íais','ían'], ir: ['ía','ías','ía','íamos','íais','ían'] }
    };
    const idx = ['1s','2s','3s','1p','2p','3p'].indexOf(code);
    return type && idx >= 0 ? stem + endings[tense][type][idx] : '';
  }

  function buildHonorsConjugationPool(prefix, verbs, tense) {
    return verbs.flatMap((verb) => HONORS_PERSONS.map((person) => ({ id: `${prefix}-${verb}-${person.code}`, verb, person: person.code, tense })));
  }
  const HONORS_PRETERITE_POOL = buildHonorsConjugationPool('honors-preterite', HONORS_PRETERITE_VERBS, 'preterite');
  const HONORS_IMPERFECT_POOL = buildHonorsConjugationPool('honors-imperfect', HONORS_IMPERFECT_VERBS, 'imperfect');
  const HONORS_ENGLISH_VERBS = { hablar: ['speak', 'talk'], estudiar: ['study'], trabajar: ['work'], caminar: ['walk'], mirar: ['watch', 'look at'], bailar: ['dance'], comprar: ['buy'], comer: ['eat'], beber: ['drink'], aprender: ['learn'], correr: ['run'], vender: ['sell'], vivir: ['live'], escribir: ['write'], recibir: ['receive', 'get'], decidir: ['decide'], abrir: ['open'], asistir: ['attend'] };

  function honorsEnglishTranslation(verb, tense, person) {
    const pronoun = { '1s': 'I', '2s': 'you', '3s': 'he/she/you', '1p': 'we', '2p': 'you all', '3p': 'they' }[person] || 'they';
    const roots = HONORS_ENGLISH_VERBS[verb] || [verb];
    const past = { buy: 'bought', eat: 'ate', write: 'wrote', run: 'ran', drink: 'drank', speak: 'spoke', talk: 'talked', live: 'lived', sell: 'sold', work: 'worked', study: 'studied', walk: 'walked', dance: 'danced', watch: 'watched', 'look at': 'looked at', learn: 'learned', receive: 'received', get: 'got', decide: 'decided', open: 'opened', attend: 'attended' };
    const answers = [];
    for (const root of roots) {
      if (tense === 'preterite') answers.push(`${pronoun} ${past[root] || `${root}ed`}`);
      else answers.push(`${pronoun} ${root}`, `${pronoun} used to ${root}`, `${pronoun} ${['I', 'he/she/you'].includes(pronoun) ? 'was' : 'were'} ${root}ing`);
    }
    return answers;
  }

  const SUMMER_TENSE_CHOICE_POOL = [
    { id:'summer-choice-younger', en:'When I was younger, I would always play with my friends.', verb:'jugar', person:'1s', tense:'imperfect', clue:'habitual action' },
    { id:'summer-choice-beach', en:'We went to the beach yesterday.', verb:'ir', person:'1p', tense:'preterite', clue:'completed action with ayer' },
    { id:'summer-choice-love', en:'I loved her very much.', verb:'querer', person:'1s', tense:'imperfect', clue:'ongoing feeling' },
    { id:'summer-choice-called', en:'I called her once yesterday.', verb:'llamar', person:'1s', tense:'preterite', clue:'single completed action' },
    { id:'summer-choice-chocolate', en:'I liked to eat chocolate every day.', verb:'gustar', person:'3s', tense:'imperfect', clue:'repeated habit' },
    { id:'summer-choice-tv', en:'My friends and I would watch television together.', verb:'ver', person:'1p', tense:'imperfect', clue:'repeated habit' },
    { id:'summer-choice-teachers', en:'I had very nice teachers.', verb:'tener', person:'1s', tense:'imperfect', clue:'description / background' },
    { id:'summer-choice-found-out', en:'I found out yesterday.', verb:'saber', person:'1s', tense:'preterite', clue:'a moment of discovery' },
    { id:'summer-choice-met', en:'He met her last week.', verb:'conocer', person:'3s', tense:'preterite', clue:'completed action with last week' },
    { id:'summer-choice-church', en:'We would go to church every Sunday.', verb:'ir', person:'1p', tense:'imperfect', clue:'repeated habit' }
  ];

  const SUMMER_TRANSLATIONS_POOL = [
    ['When I was younger, I would always play with my friends.', 'Cuando era más joven, siempre jugaba con mis amigos.', ['Cuando era más joven siempre jugaba con mis amigos.']],
    ['We would always go to the beach.', 'Siempre íbamos a la playa.', ['Siempre íbamos a la playa.']],
    ['I loved her very much.', 'La quería mucho.', ['Yo la quería mucho.','La amaba mucho.']],
    ['I called her once yesterday.', 'La llamé una vez ayer.', ['Ayer la llamé una vez.']],
    ['I liked to eat chocolate every day.', 'Me gustaba comer chocolate todos los días.', ['Me gustaba comer chocolate cada día.']],
    ['My friends and I would watch television together.', 'Mis amigos y yo veíamos la televisión juntos.', ['Mis amigos y yo mirábamos la televisión juntos.']],
    ['I had very nice teachers.', 'Tenía maestros muy buenos.', ['Yo tenía maestros muy buenos.','Tenía profesores muy buenos.']],
    ['I found out yesterday.', 'Supe ayer.', ['Me enteré ayer.','Me enteré el día de ayer.']],
    ['He met her last week.', 'La conoció la semana pasada.', ['Él la conoció la semana pasada.']],
    ['We would go to church every Sunday.', 'Íbamos a la iglesia todos los domingos.', ['Nosotros íbamos a la iglesia todos los domingos.']],
    ['Did you do it?', '¿Lo hiciste?', ['¿Tú lo hiciste?']],
    ['He had long brown hair when he was fifteen.', 'Tenía el pelo castaño y largo cuando tenía quince años.', ['Él tenía el pelo largo y castaño cuando tenía quince años.']],
    ['Were you going to the store when I saw you?', '¿Ibas a la tienda cuando te vi?', ['¿Tú ibas a la tienda cuando te vi?']],
    ['No, I could not go without my grandmother.', 'No, no pude ir sin mi abuela.', []],
    ['What did you say? I was saying…', '¿Qué dijiste? Estaba diciendo…', ['¿Qué dijiste? Yo estaba diciendo…']]
  ].map(([en, sp, acceptable], index) => ({ id:`summer-translation-${index + 1}`, en, sp, acceptable:[sp, ...acceptable] }));

  const modules = {
    // === MODULE: DAYS ===
    days: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.days.slice(-3));
        const pool = DAYS_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = DAYS_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const useMcq = !app.isNewModulesSpellingOnly() && Math.random() < 0.55;
        if (useMcq) {
          const correct = item.sp;
          const options = shuffle([correct, ...semanticDistractors(DAYS_POOL, correct, 3, (x) => x.sp)]);
          return {
            module: 'days',
            id: item.id,
            mode: 'mcq',
            prompt: `Choose the Spanish for <strong>${escapeHtml(item.en)}</strong>.`,
            options,
            correctIndex: options.indexOf(correct),
            expectedDisplay: item.sp,
            explanation: 'Days use same-category distractors.'
          };
        }
        return {
          module: 'days',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet([item.sp, item.sp.replace(/^el\s+/, '')])
        };
      }
    },

    // === MODULE: MONTHS ===
    months: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.months.slice(-3));
        const pool = MONTHS_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = MONTHS_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        if (app.isNewModulesSpellingOnly()) {
          return {
            module: 'months',
            id: item.id,
            mode: 'text',
            prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
            expectedDisplay: item.sp,
            acceptable: buildAcceptableAnswerSet(item.acceptable || [item.sp])
          };
        }
        const correct = item.sp;
        const options = shuffle([correct, ...semanticDistractors(MONTHS_POOL, correct, 3, (x) => x.sp)]);
        return {
          module: 'months',
          id: item.id,
          mode: 'mcq',
          prompt: `Choose the Spanish for <strong>${escapeHtml(item.en)}</strong>.`,
          options,
          correctIndex: options.indexOf(correct),
          expectedDisplay: item.sp,
          explanation: 'Months use same-category distractors.'
        };
      }
    },

    // === MODULE: SEASONS ===
    seasons: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.seasons.slice(-2));
        const pool = SEASONS_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = SEASONS_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        if (app.isNewModulesSpellingOnly()) {
          return {
            module: 'seasons',
            id: item.id,
            mode: 'text',
            prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
            expectedDisplay: item.sp,
            acceptable: buildAcceptableAnswerSet([item.sp])
          };
        }
        const correct = item.sp;
        const options = shuffle([correct, ...semanticDistractors(SEASONS_POOL, correct, 3, (x) => x.sp)]);
        return {
          module: 'seasons',
          id: item.id,
          mode: 'mcq',
          prompt: `Choose the Spanish for <strong>${escapeHtml(item.en)}</strong>.`,
          options,
          correctIndex: options.indexOf(correct),
          expectedDisplay: item.sp,
          explanation: 'Seasons use same-category distractors.'
        };
      }
    },

    // === MODULE: TIME ===
    time: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.time.slice(-3));
        const pool = TIME_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = TIME_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const useMcq = !app.isNewModulesSpellingOnly() && Math.random() < 0.3; // typing-first
        const expected = item.display;
        if (useMcq) {
          const near = TIME_POOL
            .filter(x => x.id !== item.id)
            .sort((a, b) => Math.abs((a.hour24 * 60 + a.minute) - (item.hour24 * 60 + item.minute)) - Math.abs((b.hour24 * 60 + b.minute) - (item.hour24 * 60 + item.minute)))
            .slice(0, 6);
          const distractors = semanticDistractors(near, expected, 3, (x) => x.display);
          const options = shuffle([expected, ...distractors]);
          return {
            module: 'time',
            id: item.id,
            mode: 'mcq',
            prompt: `Choose the best Spanish time phrase for <strong>${String(item.hour24).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}</strong>.`,
            options,
            correctIndex: options.indexOf(expected),
            expectedDisplay: expected,
            explanation: 'Time distractors are plausible nearby variants.'
          };
        }
        return {
          module: 'time',
          id: item.id,
          mode: 'text',
          prompt: `Write this time in Spanish: <strong>${String(item.hour24).padStart(2, '0')}:${String(item.minute).padStart(2, '0')}</strong>`,
          expectedDisplay: expected,
          acceptableTime: buildTimeAcceptableSet(item),
          explanation: 'Accepts spelled and numeric variants (including 24h inputs).'
        };
      }
    },

    // === MODULE: COLORS ===
    colors: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.colors.slice(-3));
        const pool = COLORS_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = COLORS_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        if (app.isNewModulesSpellingOnly()) {
          return {
            module: 'colors',
            id: item.id,
            mode: 'text',
            prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
            expectedDisplay: item.sp,
            acceptable: buildAcceptableAnswerSet([item.sp])
          };
        }
        const correct = item.sp;
        const conf = (COLOR_CONFUSABLES[normalizeLoose(item.sp)] || []).map((slug) => COLORS_POOL.find(c => normalizeLoose(c.sp) === slug)?.sp).filter(Boolean);
        const distractors = [];
        for (const d of conf) {
          if (d !== correct && !distractors.includes(d)) distractors.push(d);
          if (distractors.length >= 3) break;
        }
        if (distractors.length < 3) {
          for (const d of semanticDistractors(COLORS_POOL, correct, 5, (x) => x.sp)) {
            if (!distractors.includes(d)) distractors.push(d);
            if (distractors.length >= 3) break;
          }
        }
        const options = shuffle([correct, ...distractors.slice(0, 3)]);
        return {
          module: 'colors',
          id: item.id,
          mode: 'mcq',
          prompt: `Choose the Spanish for <strong>${escapeHtml(item.en)}</strong>.`,
          options,
          correctIndex: options.indexOf(correct),
          expectedDisplay: item.sp,
          explanation: 'Color distractors prioritize confusable colors.'
        };
      }
    },

    // === MODULE: MAYO MADNESS LEVEL 1 VOCAB ===
    mayo_madness_1: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.mayo_madness_1.slice(-3));
        const pool = MAYO_MADNESS_LEVEL_1_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = MAYO_MADNESS_LEVEL_1_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const answers = item.acceptable || [item.sp];
        return {
          module: 'mayo_madness_1',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet(answers)
        };
      }
    },

    // === MODULE: MAYO MADNESS LEVEL 2 VOCAB ===
    mayo_madness_2: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.mayo_madness_2.slice(-3));
        const pool = MAYO_MADNESS_LEVEL_2_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = MAYO_MADNESS_LEVEL_2_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const answers = item.acceptable || [item.sp];
        return {
          module: 'mayo_madness_2',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet(answers)
        };
      }
    },

    // === MODULE: MAYO MADNESS LEVEL 2 RAPID FIRE TRANSLATIONS ===
    rapid_translations_2: {
      generateQuestion(app) {
        return generateRapidFireQuestion(app, 'rapid_translations_2', RAPID_TRANSLATIONS_LEVEL_2_POOL);
      }
    },

    // === MODULE: RAPID FIRE REGULAR VERB CONJUGATIONS ===
    rapid_regular_verbs: {
      generateQuestion(app) {
        return generateRapidFireQuestion(app, 'rapid_regular_verbs', RAPID_REGULAR_VERB_POOL);
      }
    },

    // === MODULE: RAPID FIRE IRREGULAR VERB CONJUGATIONS ===
    rapid_irregular_verbs: {
      generateQuestion(app) {
        return generateRapidFireQuestion(app, 'rapid_irregular_verbs', RAPID_IRREGULAR_VERB_POOL);
      }
    },

    // === MODULE: MAYO MADNESS LEVEL 3 RAPID FIRE TRANSLATIONS ===
    mayo_madness_3_rapid_translations: {
      generateQuestion(app) {
        return generateRapidFireQuestion(app, 'mayo_madness_3_rapid_translations', MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL);
      }
    },

    // === MODULE: PRICES ===
    prices: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.prices.slice(-3));
        const pool = PRICES_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = PRICES_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const amountLabel = `$${item.amount.toFixed(2)}`;
        return {
          module: 'prices',
          id: item.id,
          mode: 'text',
          prompt: `Write this price in Spanish words: <strong>${amountLabel}</strong>`,
          expectedDisplay: priceToSpanish(item.amount),
          acceptable: buildPriceAcceptableSet(item.amount),
          explanation: 'Write full Spanish words for dollars and centavos.'
        };
      }
    },

    // === MODULE: WEATHER ===
    weather: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.weather.slice(-3));
        const pool = WEATHER_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = WEATHER_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        return {
          module: 'weather',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet(item.acceptable || [item.sp])
        };
      }
    },

    // === MODULE: CLOTHING ===
    clothing: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.clothing.slice(-3));
        const pool = CLOTHING_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = CLOTHING_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        return {
          module: 'clothing',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet(item.acceptable || [item.sp])
        };
      }
    },

    // === MODULE: FOODS ===
    foods: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.foods.slice(-3));
        const pool = FOODS_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = FOODS_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        return {
          module: 'foods',
          id: item.id,
          mode: 'text',
          prompt: `Translate to Spanish: <strong>${escapeHtml(item.en)}</strong>`,
          expectedDisplay: item.sp,
          acceptable: buildAcceptableAnswerSet(item.acceptable || [item.sp])
        };
      }
    },

    // === MODULE: PRESENT_PROGRESSIVE ===
    present_progressive: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.present_progressive.slice(-4));
        const pool = PRESENT_PROGRESSIVE_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = PRESENT_PROGRESSIVE_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const personCode = subjectToPersonCode(item.subject);
        const estar = conjugate('estar', 'present', personCode);
        const gerund = toSpanishGerund(item.infinitive);
        const expected = `${estar} ${gerund}`;
        return {
          module: 'present_progressive',
          id: item.id,
          mode: 'text',
          prompt: `Write in Spanish using present progressive: <strong>${escapeHtml(item.en)}</strong><br><small>Use <em>estar + gerundio</em>.</small>`,
          expectedDisplay: expected,
          acceptable: buildAcceptableAnswerSet([expected]),
          explanation: `Subject: ${escapeHtml(item.subject)} • Infinitive: ${escapeHtml(item.infinitive)}`
        };
      }
    },

    // === MODULE: SER_ESTAR ===
    ser_estar: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.ser_estar.slice(-4));
        const pool = SER_ESTAR_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = SER_ESTAR_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        return {
          module: 'ser_estar',
          id: item.id,
          mode: 'text',
          prompt: `Complete the blank with the correct conjugation:<br><strong>${escapeHtml(item.prompt)}</strong>${item.hint ? `<br><small>Hint: ${escapeHtml(item.hint)}</small>` : ''}`,
          expectedDisplay: item.expected,
          acceptable: buildAcceptableAnswerSet([item.expected]),
          explanation: 'Use the correctly conjugated form of ser/estar for this scenario.'
        };
      }
    },

    // === MODULE: GUSTAR ===
    gustar: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.gustar.slice(-4));
        const pool = GUSTAR_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = GUSTAR_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        return {
          module: 'gustar',
          id: item.id,
          mode: 'text',
          prompt: `Write in Spanish: <strong>${escapeHtml(item.prompt)}</strong>`,
          expectedDisplay: item.expected,
          acceptable: buildAcceptableAnswerSet([item.expected]),
          explanation: 'Match indirect object pronoun and gusta/gustan agreement.'
        };
      }
    },

    // === MODULE: DATES ===
    dates: {
      generateQuestion(app) {
        const hidden = app.state.hiddenItems;
        const recent = new Set(app.recentByModule.dates.slice(-3));
        const pool = DATES_POOL.filter(x => !hidden[x.id] && !recent.has(x.id));
        const fallback = DATES_POOL.filter(x => !hidden[x.id]);
        const item = pickByWeakScore(pool.length ? pool : fallback, app.state.itemScores, recent);
        if (!item) return null;
        const promptDate = `${item.monthEn} ${englishOrdinal(item.day)}`;
        const expected = `el ${dateDayToSpanish(item.day)} de ${item.monthSp}`;
        const acceptedDates = item.day === 1 ? [expected, `el uno de ${item.monthSp}`] : [expected];
        return {
          module: 'dates',
          id: item.id,
          mode: 'text',
          prompt: `Write this date in full Spanish (not shorthand): <strong>${escapeHtml(promptDate)}</strong>`,
          expectedDisplay: expected,
          acceptable: buildAcceptableAnswerSet(acceptedDates),
          explanation: 'Use full written Spanish date format.'
        };
      }
    },

    summer_time_words: {
      generateQuestion(app) { return generateSummerTimeWordQuestion(app); }
    },

    summer_preterite: {
      generateQuestion(app) { return generateSummerConjugationQuestion(app, 'summer_preterite', SUMMER_PRETERITE_POOL, 'preterite'); }
    },

    summer_imperfect: {
      generateQuestion(app) { return generateSummerConjugationQuestion(app, 'summer_imperfect', SUMMER_IMPERFECT_POOL, 'imperfect'); }
    },

    summer_irregular_preterite: {
      generateQuestion(app) { return generateSummerConjugationQuestion(app, 'summer_irregular_preterite', SUMMER_IRREGULAR_PRETERITE_POOL, 'preterite', true); }
    },

    summer_irregular_imperfect: {
      generateQuestion(app) { return generateSummerConjugationQuestion(app, 'summer_irregular_imperfect', SUMMER_IRREGULAR_IMPERFECT_POOL, 'imperfect', true); }
    },

    summer_tense_choice: {
      generateQuestion(app) { return generateSummerTenseChoiceQuestion(app); }
    },

    summer_translations: {
      generateQuestion(app) { return generateSummerTranslationQuestion(app); }
    },

    honors_ordinal_numbers: {
      generateQuestion(app) { return generateOrdinalQuestion(app); }
    },

    honors_test1_review: {
      generateQuestion(app) { return generateHonorsTest1Question(app); }
    }
  };

  function chooseSummerItem(app, moduleKey, pool, recentLimit = 4) {
    const hidden = app.state.hiddenItems;
    const recent = new Set((app.recentByModule[moduleKey] || []).slice(-recentLimit));
    const available = pool.filter(item => !hidden[item.id] && !recent.has(item.id));
    const fallback = pool.filter(item => !hidden[item.id]);
    return pickByWeakScore(available.length ? available : fallback, app.state.itemScores, recent);
  }

  function generateSummerTimeWordQuestion(app) {
    const item = chooseSummerItem(app, 'summer_time_words', SUMMER_TIME_WORDS_POOL, 5);
    if (!item) return null;
    return {
      module: 'summer_time_words', id: item.id, mode: 'text',
      prompt: `Translate this past-tense time phrase: <strong>${escapeHtml(item.en)}</strong>`,
      expectedDisplay: item.sp,
      acceptable: buildAcceptableAnswerSet([item.sp])
    };
  }

  function generateSummerConjugationQuestion(app, moduleKey, pool, tense, irregular = false) {
    const item = chooseSummerItem(app, moduleKey, pool, 5);
    if (!item) return null;
    const expected = `${item.prefix || ''}${conjugate(item.verb, tense, item.person)}`;
    const verbLabel = item.displayVerb || item.verb;
    return {
      module: moduleKey, id: item.id, mode: 'text', tense,
      prompt: `${irregular ? 'Conjugate this irregular verb' : 'Conjugate'}: <strong>${escapeHtml(verbLabel)}</strong> — <strong>${escapeHtml(personLabel(item.person))}</strong><br><small>${tense} tense${item.en ? ` • ${escapeHtml(item.en)}` : ''}</small>`,
      expectedDisplay: expected,
      acceptable: buildAcceptableAnswerSet([expected]),
      explanation: irregular
        ? (tense === 'imperfect' ? 'This is one of the packet’s three irregular imperfect verbs: ser, ir, or ver.' : 'This verb appears in the irregular preterite list from the summer packet.')
        : `${capitalize(tense)} endings are the focus of this drill.`
    };
  }

  function generateSummerTenseChoiceQuestion(app) {
    const item = chooseSummerItem(app, 'summer_tense_choice', SUMMER_TENSE_CHOICE_POOL, 4);
    if (!item) return null;
    const expected = conjugate(item.verb, item.tense, item.person);
    const options = shuffle(['preterite', 'imperfect']);
    return {
      module: 'summer_tense_choice', id: item.id, mode: 'mcq',
      prompt: `Which past tense fits this sentence?<br><strong>${escapeHtml(item.en)}</strong><br><small>Clue: ${escapeHtml(item.clue)}</small>`,
      options,
      correctIndex: options.indexOf(item.tense),
      expectedDisplay: expected,
      explanation: `The expected verb form is <strong>${escapeHtml(expected)}</strong>.`
    };
  }

  function generateSummerTranslationQuestion(app) {
    const item = chooseSummerItem(app, 'summer_translations', SUMMER_TRANSLATIONS_POOL, 3);
    if (!item) return null;
    return {
      module: 'summer_translations', id: item.id, mode: 'text',
      prompt: `Translate to Spanish:<br><strong>${escapeHtml(item.en)}</strong>`,
      expectedDisplay: item.sp,
      acceptable: buildAcceptableAnswerSet(item.acceptable)
    };
  }

  function chooseHonorsItem(app, moduleKey, pool, recentLimit = 6) {
    const hidden = app.state.hiddenItems;
    const recent = new Set((app.recentByModule[moduleKey] || []).slice(-recentLimit));
    const available = pool.filter((item) => !hidden[item.id] && !recent.has(item.id));
    const fallback = pool.filter((item) => !hidden[item.id]);
    return pickByWeakScore(available.length ? available : fallback, app.state.itemScores, recent);
  }

  function generateOrdinalQuestion(app) {
    const freeLimit = 12; // compact free rotation; premium sees the complete variety
    const pool = app.hasPremiumAccess() ? ORDINAL_POOL : ORDINAL_POOL.slice(0, freeLimit);
    const item = chooseHonorsItem(app, 'honors_ordinal_numbers', pool, 5);
    if (!item) return null;
    return { module: 'honors_ordinal_numbers', id: item.id, mode: 'text', prompt: item.prompt, expectedDisplay: item.expectedDisplay, acceptable: buildAcceptableAnswerSet(item.acceptable), explanation: item.explanation || 'Ordinal numbers agree with the noun they describe.' };
  }

  function honorsQuota(app, section) {
    const premium = app.hasPremiumAccess();
    const quotas = premium ? { preterite: 6, imperfect: 6, vocabulary: 5, translation: 4, choice: 3 } : { preterite: 4, imperfect: 4, vocabulary: 3, translation: 2, choice: 3 };
    return { target: Object.values(quotas).reduce((sum, value) => sum + value, 0), used: app.activeSession?.sectionCounts?.[section] || 0, max: quotas[section] };
  }

  function generateHonorsTest1Question(app) {
    const sections = ['preterite', 'imperfect', 'vocabulary', 'translation', 'choice'];
    const open = sections.filter((section) => honorsQuota(app, section).used < honorsQuota(app, section).max);
    // Quotas shape the beginning of a session; they never end practice.
    const section = pickRandom(open.length ? open : sections);
    let q;
    if (section === 'vocabulary') {
      const item = chooseHonorsItem(app, 'honors_test1_review', HONORS_TIME_WORDS.slice(0, app.hasPremiumAccess() ? HONORS_TIME_WORDS.length : 12), 5);
      if (!item) return null;
      q = { id: item.id, prompt: `Translate into Spanish: <strong>“${escapeHtml(item.en[0])}”</strong>`, expectedDisplay: item.sp, acceptable: [item.sp], explanation: 'Write the Spanish time expression. Accents are optional for correctness.' };
    } else if (section === 'translation') {
      const sourcePool = app.hasPremiumAccess() ? HONORS_PRETERITE_POOL.concat(HONORS_IMPERFECT_POOL) : HONORS_PRETERITE_POOL.slice(0, 30).concat(HONORS_IMPERFECT_POOL.slice(0, 30));
      const item = chooseHonorsItem(app, 'honors_test1_review', sourcePool, 5);
      if (!item) return null;
      const form = honorsRegularConjugate(item.verb, item.tense, item.person);
      const person = HONORS_PERSONS_BY_CODE[item.person];
      const english = honorsEnglishTranslation(item.verb, item.tense, item.person);
      q = { id: `honors-translation-${item.id}`, prompt: `Translate to English: <strong>${escapeHtml(form)}</strong><br><small>Regular ${item.tense} form of ${escapeHtml(item.verb)}</small>`, expectedDisplay: english[0], acceptable: english, explanation: 'Acceptable English depends on the past-tense meaning; natural wording is welcome.' };
    } else if (section === 'choice') {
      const item = chooseHonorsItem(app, 'honors_test1_review', HONORS_CHOICE_POOL, 3);
      if (!item) return null;
      const options = shuffle(['preterite', 'imperfect']);
      q = { id: item.id, mode: 'mcq', prompt: `Choose the correct past tense:<br><strong>${escapeHtml(item.sentence)}</strong><br><small>Context: ${escapeHtml(item.clue)}</small>`, options, correctIndex: options.indexOf(item.tense), expectedDisplay: honorsRegularConjugate(item.verb, item.tense, item.person), explanation: `The expected form is <strong>${escapeHtml(honorsRegularConjugate(item.verb, item.tense, item.person))}</strong>.` };
    } else {
      const tense = section === 'preterite' ? 'preterite' : 'imperfect';
      const pool = tense === 'preterite' ? HONORS_PRETERITE_POOL : HONORS_IMPERFECT_POOL;
      const item = chooseHonorsItem(app, 'honors_test1_review', pool, 5);
      if (!item) return null;
      const form = honorsRegularConjugate(item.verb, tense, item.person);
      const person = HONORS_PERSONS_BY_CODE[item.person];
      const sentence = (item.person === '1s' && item.verb === 'hablar') ? 'Ayer, yo ___ con mi profesora.' : (item.person === '1p' && item.verb === 'comer') ? 'Después de clase, nosotros ___ juntos.' : null;
      const identifyInfinitive = !sentence && Math.random() < 0.18;
      q = { id: item.id, prompt: identifyInfinitive ? `Identify the infinitive: <strong>${escapeHtml(form)}</strong> (${tense})` : sentence ? `Complete the sentence (${tense}): <strong>${sentence}</strong>` : `Conjugate <strong>${escapeHtml(item.verb)}</strong> for <strong>${escapeHtml(person.display)}</strong> in the <strong>${tense}</strong>.`, expectedDisplay: identifyInfinitive ? item.verb : form, acceptable: [identifyInfinitive ? item.verb : form], explanation: identifyInfinitive ? 'Look past the ending to identify the regular infinitive.' : `${capitalize(tense)} regular ${verbType(item.verb).toUpperCase()} endings are the focus.` };
    }
    if (app.activeSession?.sectionCounts) app.activeSession.sectionCounts[section] = (app.activeSession.sectionCounts[section] || 0) + 1;
    return { module: 'honors_test1_review', mode: q.mode || 'text', ...q, acceptable: q.acceptable instanceof Set ? q.acceptable : buildAcceptableAnswerSet(q.acceptable) };
  }

  // --------------------------------------------
  // App
  // --------------------------------------------
  const App = {
    state: null,

    vocab: [],
    vocabById: new Map(),

    commandPool: [],
    reflexivePool: [],
    tensesPool: [],
    reflexiveIdSet: new Set(),
    tensesIdSet: new Set(),

    currentQuestion: null,
    answered: false,
    mayoPremiumUnlocked: false,
    premiumAccessMode: null,
    premiumAccessExpiresAt: 0,
    activeSession: null,
    sessionQuestionRecorded: false,

    // Numbers module (original behavior)
    currentNumber: null,
    practiceRequested: false,
    numbersStatus: '',

    // Rotation
    soloMode: null, // moduleKey or null
    recentByModule: {
      numbers: [],
      commands: [],
      vocab: [],
      mayo_madness_1: [],
      mayo_madness_2: [],
      rapid_translations_2: [],
      rapid_regular_verbs: [],
      rapid_irregular_verbs: [],
      mayo_madness_3_rapid_translations: [],
      reflexive: [],
      tenses: [],
      days: [],
      months: [],
      seasons: [],
      time: [],
      colors: [],
      prices: [],
      weather: [],
      clothing: [],
      foods: [],
      present_progressive: [],
      ser_estar: [],
      gustar: [],
      dates: [],
      summer_time_words: [],
      summer_preterite: [],
      summer_imperfect: [],
      summer_irregular_preterite: [],
      summer_irregular_imperfect: [],
      summer_tense_choice: [],
      summer_translations: []
    },

    saveTimer: null,
    lastFocus: null,
    isComposing: false,
    revealStage: 0,
    undoResetSnapshot: null,
    undoTimer: null,

    $: {},

    init() {
      try {
        this.cacheDom();
        this.organizeModuleSettings();
        this.ensureAriaLabels();
      // Load state
      this.state = getState();
      this.state.hiddenItems = this.state.hiddenItems || this.state.hiddenQuestions || {};
      this.state.hiddenQuestions = this.state.hiddenItems;
      this.state.moduleChoices = this.state.moduleChoices || { practiceMix: 50, showKeyHintStrip: false, newModulesAnswerMode: 'spelling' };
      this.state.itemScores = this.state.itemScores || {};
      this.state.answerHistory = this.state.answerHistory || {};
      Object.defineProperty(this.state.itemScores, '__practiceApp', { value: this, enumerable: false, configurable: true });
      this.ensureProfileAndAnalytics();
      this.loadPremiumAccess();
      const lastView = readLastViewCookie() || {};
      const requestedLevel = new URLSearchParams(window.location.search).get('class');
      this.currentLevel = requestedLevel === 'spanish2' || requestedLevel === 'spanish1'
        ? requestedLevel
        : (this.state.lastLevel || lastView.level || 'spanish1');
      this.soloMode = this.state.lastModule || lastView.module || null;
      this.setLevel(this.currentLevel, { historyMode: 'replace' });

      // Parse vocab
      this.vocab = parseQuizletBlock(QUIZLET_VOCAB_BLOCK);
      this.vocabById = new Map(this.vocab.map(v => [v.id, v]));

      // Checksum for list versioning
      const checksum = fnv1a32(QUIZLET_VOCAB_BLOCK);
      if (!this.state.vocabChecksum) this.state.vocabChecksum = checksum;
      // If list changed, we keep hiddenQuestions as-is (user intent), but we update checksum for export clarity.
      if (this.state.vocabChecksum !== checksum) {
        this.state.vocabChecksum = checksum;
        this.saveSoon();
      }

      this.buildPools();
      this.refreshSettingsUI();
      this.renderKeyHintStrip();

      // Auto-disable empty modules (edge case handling)
      this.ensureModuleAvailability();

      this.wireEvents();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
      this.returnHome();

      // First-run overlay
      if (!this.state.settings.firstRunSeen) {
        this.openModal(this.$.firstRunOverlay, this.$.firstRunGotItBtn);
      }

        // Questions are created when the user enters a dashboard. This keeps
        // dashboard state from leaking into the next practice session.
        this.runAutomatedChecks({ startup: true });
      } catch (err) {
        console.error('App init failed', err);
        try {
          if (this.$ && this.$.banner && this.$.bannerText) {
            this.showBanner('<strong>Startup error.</strong> Check console for details and reload.');
          }
        } catch (_) {}
      }
    },

    ensureAriaLabels() {
      const nodes = document.querySelectorAll('button, input, select, textarea');
      for (const el of nodes) {
        if (el.getAttribute('aria-label')) continue;
        const text = (el.textContent || el.value || '').trim();
        if (text) el.setAttribute('aria-label', text);
        else if (el.id) el.setAttribute('aria-label', el.id);
      }
    },

    organizeModuleSettings() {
      const section = document.querySelector('#moduleSettingsSection > .accordion-inner');
      if (!section || section.dataset.organized === 'true') return;
      const groups = [
        { title: 'Essentials', keys: ['numbers', 'commands', 'vocab'] },
        { title: 'Everyday topics', keys: ['days', 'months', 'seasons', 'time', 'colors'] },
        { title: 'Grammar', keys: ['reflexive', 'tenses', 'present_progressive', 'ser_estar', 'gustar'] },
        { title: 'Situations', keys: ['prices', 'weather', 'clothing', 'foods', 'dates'] },
        { title: 'Challenges', keys: ['mayo'] }
      ];
      const nodes = new Map();
      for (const key of ['numbers', 'commands', 'vocab', 'reflexive', 'tenses', 'days', 'months', 'seasons', 'time', 'colors', 'prices', 'weather', 'clothing', 'foods', 'present_progressive', 'ser_estar', 'gustar', 'dates']) {
        const node = section.querySelector(`#toggle_${key}`)?.closest('.toggle');
        if (node) nodes.set(key, node);
      }
      const mayo = section.querySelector('#mayoMadnessDetails');
      for (const groupInfo of groups) {
        const group = document.createElement('details');
        group.className = 'module-group';
        group.open = ['Essentials', 'Everyday topics', 'Grammar', 'Situations'].includes(groupInfo.title);
        const summary = document.createElement('summary');
        summary.textContent = groupInfo.title;
        const content = document.createElement('div');
        content.className = 'module-group-content';
        for (const key of groupInfo.keys) {
          const node = key === 'mayo' ? mayo : nodes.get(key);
          if (node) content.appendChild(node);
        }
        group.append(summary, content);
        section.appendChild(group);
      }
      section.dataset.organized = 'true';
    },

    cacheDom() {
      const $ = (id) => document.getElementById(id);
      this.$ = {
        subtitle: $('subtitle'),
        brandName: $('brandName'),
        headerLevel: $('headerLevel'),
        activeModuleLabel: $('activeModuleLabel'),
        activeModuleMeta: $('activeModuleMeta'),

        banner: $('banner'),
        bannerText: $('bannerText'),
        bannerRestoreBtn: $('bannerRestoreBtn'),
        bannerDismissBtn: $('bannerDismissBtn'),

        homeCard: $('homeCard'),
        homeModuleSummary: $('homeModuleSummary'),
        enterPracticeBtn: $('enterPracticeBtn'),
        homeSettingsBtn: $('homeSettingsBtn'),
        allTimeAccuracy: $('allTimeAccuracy'),
        allTimeCorrect: $('allTimeCorrect'),
        allTimeAnsweredLabel: $('allTimeAnsweredLabel'),
        allTimeCurrentStreak: $('allTimeCurrentStreak'),
        allTimeBestStreak: $('allTimeBestStreak'),
        allTimeSessions: $('allTimeSessions'),
        profileNote: $('profileNote'),
        sessionHistory: $('sessionHistory'),
        sessionHistoryEmpty: $('sessionHistoryEmpty'),
        spanish1Tab: $('spanish1Tab'),
        spanish2Tab: $('spanish2Tab'),
        spanish1Panel: $('spanish1Panel'),
        spanish2Panel: $('spanish2Panel'),
        spanish2ModuleSummary: $('spanish2ModuleSummary'),
        backHomeBtn: $('backHomeBtn'),
        mainCard: $('mainCard'),
        sessionStats: $('sessionStats'),
        sessionCorrect: $('sessionCorrect'),
        sessionIncorrect: $('sessionIncorrect'),
        sessionAnswered: $('sessionAnswered'),
        sessionAccuracy: $('sessionAccuracy'),
        sessionStreak: $('sessionStreak'),
        endSessionBtn: $('endSessionBtn'),

        countsRow: $('countsRow'),

        // practice only
        soloNumbersBtn: $('soloNumbersBtn'),
        soloCommandsBtn: $('soloCommandsBtn'),
        soloVocabBtn: $('soloVocabBtn'),
        soloMayoMadnessBtn: $('soloMayoMadnessBtn'),
        soloMayoMadness1Btn: $('soloMayoMadness1Btn'),
        soloMayoMadness2Btn: $('soloMayoMadness2Btn'),
        soloRapidTranslations2Btn: $('soloRapidTranslations2Btn'),
        soloRapidRegularVerbsBtn: $('soloRapidRegularVerbsBtn'),
        soloRapidIrregularVerbsBtn: $('soloRapidIrregularVerbsBtn'),
        soloMayoMadness3RapidTranslationsBtn: $('soloMayoMadness3RapidTranslationsBtn'),
        soloReflexiveBtn: $('soloReflexiveBtn'),
        soloTensesBtn: $('soloTensesBtn'),
        soloDaysBtn: $('soloDaysBtn'),
        soloMonthsBtn: $('soloMonthsBtn'),
        soloSeasonsBtn: $('soloSeasonsBtn'),
        soloTimeBtn: $('soloTimeBtn'),
        soloColorsBtn: $('soloColorsBtn'),
        soloPricesBtn: $('soloPricesBtn'),
        soloWeatherBtn: $('soloWeatherBtn'),
        soloClothingBtn: $('soloClothingBtn'),
        soloFoodsBtn: $('soloFoodsBtn'),
        soloPresentProgressiveBtn: $('soloPresentProgressiveBtn'),
        soloSerEstarBtn: $('soloSerEstarBtn'),
        soloGustarBtn: $('soloGustarBtn'),
        soloDatesBtn: $('soloDatesBtn'),
        soloHonorsOrdinalBtn: $('soloHonorsOrdinalBtn'),
        soloHonorsTest1Btn: $('soloHonorsTest1Btn'),
        soloOffBtn: $('soloOffBtn'),
        soloSelect: $('soloSelect'),
        soloOffMobileBtn: $('soloOffMobileBtn'),
        keyHintStrip: $('keyHintStrip'),

        neverBtn: $('neverBtn'),

        // numbers
        numbersSection: $('numbersSection'),
        numbersTitle: $('numbersTitle'),
        numbersLead: $('numbersLead'),
        numberDisplay: $('numberDisplay'),
        numberSpanish: $('numberSpanish'),
        numberTypingBlock: $('numberTypingBlock'),
        numberAnswerInput: $('numberAnswerInput'),
        numberFeedback: $('numberFeedback'),
        revealBtn: $('revealBtn'),
        submitNumberBtn: $('submitNumberBtn'),
        nextNumbersBtn: $('nextNumbersBtn'),
        practiceBtn: $('practiceBtn'),
        practiceIndicator: $('practiceIndicator'),
        numbersHint: $('numbersHint'),
        numbersGuideBtn: $('numbersGuideBtn'),

        // qa
        qaSection: $('qaSection'),
        qaTitle: $('qaTitle'),
        qaPrompt: $('qaPrompt'),
        mcqBlock: $('mcqBlock'),
        mcqList: $('mcqList'),
        textBlock: $('textBlock'),
        accentToolbar: $('accentToolbar'),
        answerInput: $('answerInput'),
        submitBtn: $('submitBtn'),
        nextQBtn: $('nextQBtn'),
        feedback: $('feedback'),

        // settings modal
        premiumBtn: $('premiumBtn'),
        settingsBtn: $('settingsBtn'),
        settingsOverlay: $('settingsOverlay'),
        settingsCloseBtn: $('settingsCloseBtn'),
        settingsIntro: $('settingsIntro'),

        toggle_numbers: $('toggle_numbers'),
        toggle_commands: $('toggle_commands'),
        toggle_vocab: $('toggle_vocab'),
        mayoMadnessDetails: $('mayoMadnessDetails'),
        mayoSubmoduleList: $('mayoSubmoduleList'),
        mayoLockedNote: $('mayoLockedNote'),
        toggle_mayo_madness: $('toggle_mayo_madness'),
        toggle_mayo_madness_1: $('toggle_mayo_madness_1'),
        toggle_mayo_madness_2: $('toggle_mayo_madness_2'),
        toggle_rapid_translations_2: $('toggle_rapid_translations_2'),
        toggle_rapid_regular_verbs: $('toggle_rapid_regular_verbs'),
        toggle_rapid_irregular_verbs: $('toggle_rapid_irregular_verbs'),
        toggle_mayo_madness_3_rapid_translations: $('toggle_mayo_madness_3_rapid_translations'),
        toggle_reflexive: $('toggle_reflexive'),
        toggle_tenses: $('toggle_tenses'),
        toggle_days: $('toggle_days'),
        toggle_months: $('toggle_months'),
        toggle_seasons: $('toggle_seasons'),
        toggle_time: $('toggle_time'),
        toggle_colors: $('toggle_colors'),
        toggle_prices: $('toggle_prices'),
        toggle_weather: $('toggle_weather'),
        toggle_clothing: $('toggle_clothing'),
        toggle_foods: $('toggle_foods'),
        toggle_present_progressive: $('toggle_present_progressive'),
        toggle_ser_estar: $('toggle_ser_estar'),
        toggle_gustar: $('toggle_gustar'),
        toggle_dates: $('toggle_dates'),
        toggle_summer_time_words: $('toggle_summer_time_words'),
        toggle_summer_preterite: $('toggle_summer_preterite'),
        toggle_summer_imperfect: $('toggle_summer_imperfect'),
        toggle_summer_irregular_preterite: $('toggle_summer_irregular_preterite'),
        toggle_summer_irregular_imperfect: $('toggle_summer_irregular_imperfect'),
        toggle_summer_tense_choice: $('toggle_summer_tense_choice'),
        toggle_summer_translations: $('toggle_summer_translations'),
        toggle_honors_ordinal_numbers: $('toggle_honors_ordinal_numbers'),
        toggle_honors_test1_review: $('toggle_honors_test1_review'),

        tense_present: $('tense_present'),
        tense_preterite: $('tense_preterite'),
        tense_imperfect: $('tense_imperfect'),
        tense_irregular_only: $('tense_irregular_only'),

        vocab_weighted: $('vocab_weighted'),
        vocab_uniform: $('vocab_uniform'),
        numbersMinRange: $('numbersMinRange'),
        numbersMinInput: $('numbersMinInput'),
        numbersMinValue: $('numbersMinValue'),
        numbersMaxRange: $('numbersMaxRange'),
        numbersMaxInput: $('numbersMaxInput'),
        numbersMaxValue: $('numbersMaxValue'),
        numbersRequireTyping: $('numbersRequireTyping'),
        numbersSequential: $('numbersSequential'),

        manageHiddenBtn: $('manageHiddenBtn'),
        hiddenCountLabel: $('hiddenCountLabel'),

        exportAllBtn: $('exportAllBtn'),
        importAllBtn: $('importAllBtn'),
        importAllFile: $('importAllFile'),
        resetBtn: $('resetBtn'),
        undoToast: $('undoToast'),
        undoToastText: $('undoToastText'),
        undoResetBtn: $('undoResetBtn'),
        practiceMixRange: $('practiceMixRange'),
        practiceMixValue: $('practiceMixValue'),
        prioritizeWeakQuestions: $('prioritizeWeakQuestions'),
        newModulesMode_spelling: $('newModulesMode_spelling'),
        newModulesMode_mixed: $('newModulesMode_mixed'),
        toggleKeyHintStrip: $('toggleKeyHintStrip'),
        toggleDebugMode: $('toggleDebugMode'),
        runChecksBtn: $('runChecksBtn'),
        checksOutput: $('checksOutput'),

        // premium modal
        premiumOverlay: $('premiumOverlay'),
        premiumCloseBtn: $('premiumCloseBtn'),
        premiumPasswordInput: $('premiumPasswordInput'),
        premiumSubmitBtn: $('premiumSubmitBtn'),
        premiumFeedback: $('premiumFeedback'),
        premiumRequestToggle: $('premiumRequestToggle'),
        premiumRequestForm: $('premiumRequestForm'),
        premiumRequestName: $('premiumRequestName'),
        premiumRequestEmail: $('premiumRequestEmail'),
        premiumRequestSubmit: $('premiumRequestSubmit'),
        premiumRequestFeedback: $('premiumRequestFeedback'),

        // feedback
        feedbackBtn: $('feedbackBtn'),
        feedbackOverlay: $('feedbackOverlay'),
        feedbackCloseBtn: $('feedbackCloseBtn'),
        feedbackCancelBtn: $('feedbackCancelBtn'),
        feedbackForm: $('feedbackForm'),
        feedbackType: $('feedbackType'),
        feedbackModuleRequestField: $('feedbackModuleRequestField'),
        feedbackModuleRequest: $('feedbackModuleRequest'),
        feedbackMessage: $('feedbackMessage'),
        feedbackEmail: $('feedbackEmail'),
        feedbackWebsite: $('feedbackWebsite'),
        feedbackSubmitBtn: $('feedbackSubmitBtn'),
        feedbackStatus: $('feedbackStatus'),

        // end-session confirmation
        endSessionOverlay: $('endSessionOverlay'),
        endSessionCloseBtn: $('endSessionCloseBtn'),
        continueSessionBtn: $('continueSessionBtn'),
        confirmEndSessionBtn: $('confirmEndSessionBtn'),
        endSessionSummary: $('endSessionSummary'),

        // numbers guide modal
        numbersGuideOverlay: $('numbersGuideOverlay'),
        numbersGuideCloseBtn: $('numbersGuideCloseBtn'),

        // hidden modal
        hiddenOverlay: $('hiddenOverlay'),
        hiddenCloseBtn: $('hiddenCloseBtn'),
        restoreSelectedBtn: $('restoreSelectedBtn'),
        restoreAllBtn: $('restoreAllBtn'),
        exportHiddenBtn: $('exportHiddenBtn'),
        importHiddenBtn: $('importHiddenBtn'),
        importHiddenFile: $('importHiddenFile'),
        importHiddenReplace: $('importHiddenReplace'),
        hiddenSummary: $('hiddenSummary'),
        hiddenList: $('hiddenList'),
        hiddenEmptyNote: $('hiddenEmptyNote'),

        // first run
        firstRunOverlay: $('firstRunOverlay'),
        firstRunCloseBtn: $('firstRunCloseBtn'),
        firstRunGotItBtn: $('firstRunGotItBtn')
      };
    },

    wireEvents() {
      // Settings open/close
      this.$.premiumBtn.addEventListener('click', () => this.openPremiumAccess());
      this.$.settingsBtn.addEventListener('click', () => this.openSettings());
      this.$.enterPracticeBtn.addEventListener('click', () => this.enterPractice());
      this.$.homeSettingsBtn.addEventListener('click', () => this.openSettings());
      this.$.backHomeBtn.addEventListener('click', () => this.requestEndSession());
      this.$.spanish1Tab.addEventListener('click', () => this.setLevel('spanish1', { historyMode: 'push' }));
      this.$.spanish2Tab.addEventListener('click', () => this.setLevel('spanish2', { historyMode: 'push' }));
      this.$.settingsCloseBtn.addEventListener('click', () => this.closeModal(this.$.settingsOverlay));
      this.$.settingsOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.settingsOverlay) this.closeModal(this.$.settingsOverlay);
      });

      // Premium access
      this.$.premiumCloseBtn.addEventListener('click', () => this.closeModal(this.$.premiumOverlay));
      this.$.premiumOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.premiumOverlay) this.closeModal(this.$.premiumOverlay);
      });
      this.$.premiumSubmitBtn.addEventListener('click', () => this.submitPremiumPassword());
      this.$.premiumPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitPremiumPassword();
        }
      });
      this.$.premiumRequestToggle.addEventListener('click', () => {
        const form = this.$.premiumRequestForm;
        form.hidden = !form.hidden;
        if (!form.hidden) this.$.premiumRequestName.focus();
      });
      this.$.premiumRequestForm.addEventListener('submit', (e) => this.submitPremiumRequest(e));

      // Feedback
      this.$.feedbackBtn.addEventListener('click', () => this.openFeedback());
      this.$.feedbackCloseBtn.addEventListener('click', () => this.closeModal(this.$.feedbackOverlay));
      this.$.feedbackCancelBtn.addEventListener('click', () => this.closeModal(this.$.feedbackOverlay));
      this.$.feedbackOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.feedbackOverlay) this.closeModal(this.$.feedbackOverlay);
      });
      this.$.feedbackForm.addEventListener('submit', (e) => this.submitFeedback(e));
      this.$.feedbackType.addEventListener('change', () => this.updateFeedbackTypeUI());
      window.addEventListener('popstate', () => {
        const level = new URLSearchParams(window.location.search).get('class');
        this.setLevel(level, { historyMode: 'none' });
      });

      // Session lifecycle
      this.$.endSessionBtn.addEventListener('click', () => this.requestEndSession());
      this.$.endSessionCloseBtn.addEventListener('click', () => this.resumePracticeSession());
      this.$.continueSessionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.resumePracticeSession();
      });
      this.$.confirmEndSessionBtn.addEventListener('click', () => this.finishPracticeSession());
      this.$.endSessionOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.endSessionOverlay) this.closeModal(this.$.endSessionOverlay);
      });
      this.$.toggle_mayo_madness.addEventListener('click', (e) => e.stopPropagation());
      this.$.toggle_mayo_madness.addEventListener('change', () => {
        if (!this.hasPremiumAccess()) {
          this.$.toggle_mayo_madness.checked = false;
          this.openPremiumAccess();
          return;
        }
        this.state.settings.mayoMadnessEnabled = !!this.$.toggle_mayo_madness.checked;
        if (!this.state.settings.mayoMadnessEnabled && this.currentQuestion && isMayoMadnessKey(this.currentQuestion.module)) {
          this.soloMode = null;
          this.nextQuestion({ keepFeedback: false });
        }
        this.saveSoon();
        this.refreshSettingsUI();
        this.updateCountsRow();
      });

      // Numbers guide
      this.$.numbersGuideBtn.addEventListener('click', () => this.openModal(this.$.numbersGuideOverlay, this.$.numbersGuideCloseBtn));
      this.$.numbersGuideCloseBtn.addEventListener('click', () => this.closeModal(this.$.numbersGuideOverlay));
      this.$.numbersGuideOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.numbersGuideOverlay) this.closeModal(this.$.numbersGuideOverlay);
      });

      // Hidden manager
      this.$.manageHiddenBtn.addEventListener('click', () => this.openHiddenManager());
      this.$.hiddenCloseBtn.addEventListener('click', () => this.closeModal(this.$.hiddenOverlay));
      this.$.hiddenOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.hiddenOverlay) this.closeModal(this.$.hiddenOverlay);
      });

      this.$.restoreSelectedBtn.addEventListener('click', () => this.restoreSelectedHidden());
      this.$.restoreAllBtn.addEventListener('click', () => this.restoreAllHidden());
      this.$.exportHiddenBtn.addEventListener('click', () => this.exportHidden());
      this.$.importHiddenBtn.addEventListener('click', () => this.$.importHiddenFile.click());
      this.$.importHiddenFile.addEventListener('change', (e) => this.importHiddenFile(e));

      // Banner
      this.$.bannerDismissBtn.addEventListener('click', () => this.hideBanner());
      this.$.bannerRestoreBtn.addEventListener('click', () => this.openHiddenManager());

      // Practice-only
      const soloButtons = [
        this.$.soloNumbersBtn,
        this.$.soloCommandsBtn,
        this.$.soloVocabBtn,
        this.$.soloMayoMadnessBtn,
        this.$.soloMayoMadness1Btn,
        this.$.soloMayoMadness2Btn,
        this.$.soloRapidTranslations2Btn,
        this.$.soloRapidRegularVerbsBtn,
        this.$.soloRapidIrregularVerbsBtn,
        this.$.soloMayoMadness3RapidTranslationsBtn,
        this.$.soloReflexiveBtn,
        this.$.soloTensesBtn,
        this.$.soloDaysBtn,
        this.$.soloMonthsBtn,
        this.$.soloSeasonsBtn,
        this.$.soloTimeBtn,
        this.$.soloColorsBtn,
        this.$.soloPricesBtn,
        this.$.soloWeatherBtn,
        this.$.soloClothingBtn,
        this.$.soloFoodsBtn,
        this.$.soloPresentProgressiveBtn,
        this.$.soloSerEstarBtn,
        this.$.soloGustarBtn,
        this.$.soloDatesBtn,
        this.$.soloHonorsOrdinalBtn,
        this.$.soloHonorsTest1Btn
      ];
      for (const btn of soloButtons) {
        btn.addEventListener('click', () => {
          const moduleKey = btn.dataset.solo;
          this.setSoloMode(moduleKey);
        });
      }
      this.$.soloOffBtn.addEventListener('click', () => this.clearSoloMode());
      this.$.soloOffMobileBtn.addEventListener('click', () => this.clearSoloMode());
      this.$.soloSelect.addEventListener('change', () => {
        if (!this.$.soloSelect.value) this.clearSoloMode();
        else this.setSoloMode(this.$.soloSelect.value);
      });

      // "Never show again"
      this.$.neverBtn.addEventListener('click', () => this.hideCurrentQuestion());

      // Numbers buttons
      this.$.revealBtn.addEventListener('click', () => this.revealSpanishNumber());
      this.$.submitNumberBtn.addEventListener('click', () => this.submitNumberAnswer());
      this.$.nextNumbersBtn.addEventListener('click', () => this.nextQuestion({ keepFeedback: false }));
      this.$.practiceBtn.addEventListener('click', () => this.markNeedPractice());
      this.$.numberAnswerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.answered) this.nextQuestion({ keepFeedback: false });
          else this.submitNumberAnswer();
        }
      });

      // Accent buttons
      this.$.accentToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-accent]');
        if (!btn) return;
        this.insertAccent(btn.dataset.accent);
      });

      // Submit/Next
      this.$.submitBtn.addEventListener('click', () => this.submitAnswer());
      this.$.nextQBtn.addEventListener('click', () => this.nextQuestion({ keepFeedback: false }));

      // Enter submits; if already answered, Enter moves Next.
      this.$.answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.answered) this.nextQuestion({ keepFeedback: false });
          else this.submitAnswer();
        }
      });
      this.$.answerInput.addEventListener('compositionstart', () => { this.isComposing = true; });
      this.$.answerInput.addEventListener('compositionend', () => { this.isComposing = false; });
      window.addEventListener('compositionstart', () => { this.isComposing = true; });
      window.addEventListener('compositionend', () => { this.isComposing = false; });

      // Settings toggles
      const moduleToggle = (key) => {
        const el = this.$['toggle_' + key];
        if (!el) {
          if (window.APP_DEBUG) console.warn('Missing module toggle element for', key);
          return;
        }
        el.addEventListener('change', () => {
          this.state.settings.modulesEnabled[key] = !!el.checked;
          // If user disables current solo module, clear solo
          if (!this.state.settings.modulesEnabled[key] && this.soloMode === key) this.soloMode = null;
          this.ensureModuleAvailability();
          this.saveSoon();
          this.updateCountsRow();
          this.updateHiddenCountLabel();

          // If everything got disabled, re-enable numbers as a sane default (unless it's empty too).
          if (!this.anyModuleEnabled()) {
            this.state.settings.modulesEnabled.numbers = true;
            this.ensureModuleAvailability();
            this.saveSoon();
          }

          // If current module just got disabled, move to next available question
          if (this.currentQuestion && !this.state.settings.modulesEnabled[this.currentQuestion.module]) {
            this.nextQuestion({ keepFeedback: false });
          }
        });
      };
      for (const m of MODULES) moduleToggle(m.key);

      // Tense checkboxes
      const tenseToggle = (tenseKey) => {
        const el = this.$['tense_' + tenseKey];
        el.addEventListener('change', () => {
          this.state.settings.tensesEnabled[tenseKey] = !!el.checked;
          // If tenses module enabled but none selected, restore present.
          if (this.state.settings.modulesEnabled.tenses && !this.anyTenseEnabled()) {
            this.state.settings.tensesEnabled.present = true;
            this.$.tense_present.checked = true;
            this.showBanner('No tenses selected. Present was re-enabled automatically.');
          }
          this.saveSoon();
          this.updateCountsRow();

          // If currently on a tenses question that is now disallowed, move on.
          if (this.currentQuestion && this.currentQuestion.module === 'tenses') {
            const t = this.currentQuestion.tense;
            if (!this.state.settings.tensesEnabled[t]) this.nextQuestion({ keepFeedback: false });
          }
        });
      };
      tenseToggle('present');
      tenseToggle('preterite');
      tenseToggle('imperfect');
      this.$.tense_irregular_only.addEventListener('change', () => {
        this.state.settings.tensesIrregularOnly = !!this.$.tense_irregular_only.checked;
        this.saveSoon();
        this.updateCountsRow();
        if (this.currentQuestion && this.currentQuestion.module === 'tenses' && !this.isTenseItemAllowed(this.currentQuestion)) {
          this.nextQuestion({ keepFeedback: false });
        }
      });

      this.$.numbersMinRange.addEventListener('input', () => this.applyNumbersRangeFromControls('minRange'));
      this.$.numbersMaxRange.addEventListener('input', () => this.applyNumbersRangeFromControls('maxRange'));
      this.$.numbersMinRange.addEventListener('change', () => this.ensureCurrentNumberInRange());
      this.$.numbersMaxRange.addEventListener('change', () => this.ensureCurrentNumberInRange());
      this.$.numbersMinInput.addEventListener('input', () => this.applyNumbersRangeFromControls('minInput'));
      this.$.numbersMaxInput.addEventListener('input', () => this.applyNumbersRangeFromControls('maxInput'));
      this.$.numbersMinInput.addEventListener('change', () => {
        this.refreshSettingsUI();
        this.ensureCurrentNumberInRange();
      });
      this.$.numbersMaxInput.addEventListener('change', () => {
        this.refreshSettingsUI();
        this.ensureCurrentNumberInRange();
      });
      this.$.numbersRequireTyping.addEventListener('change', () => {
        this.state.settings.numbersRequireTyping = !!this.$.numbersRequireTyping.checked;
        this.saveSoon();
        if (this.currentQuestion && this.currentQuestion.module === 'numbers') {
          this.renderQuestion(this.currentQuestion, { keepFeedback: false });
        }
      });
      this.$.numbersSequential.addEventListener('change', () => {
        this.state.settings.numbersSequential = !!this.$.numbersSequential.checked;
        this.practiceRequested = false;
        this.numbersStatus = this.state.settings.numbersSequential
          ? 'Order mode: next Numbers question will move through the range.'
          : '';
        this.saveSoon();
        if (this.currentQuestion && this.currentQuestion.module === 'numbers') {
          this.$.practiceIndicator.textContent = this.numbersStatus;
        }
      });

      // Vocab mode
      const modeRadios = [this.$.vocab_weighted, this.$.vocab_uniform];
      for (const r of modeRadios) {
        r.addEventListener('change', () => {
          if (r.checked) {
            this.state.settings.vocabMode = r.value;
            this.saveSoon();
          }
        });
      }

      this.$.practiceMixRange.addEventListener('input', () => {
        const v = Math.max(0, Math.min(100, parseInt(this.$.practiceMixRange.value, 10) || 50));
        this.state.moduleChoices.practiceMix = v;
        this.$.practiceMixValue.textContent = String(v);
        this.saveSoon();
      });
      this.$.prioritizeWeakQuestions.addEventListener('change', () => {
        this.state.settings.prioritizeWeakQuestions = this.$.prioritizeWeakQuestions.checked;
        this.saveSoon();
      });
      const newModulesModeRadios = [this.$.newModulesMode_spelling, this.$.newModulesMode_mixed];
      for (const r of newModulesModeRadios) {
        if (!r) continue;
        r.addEventListener('change', () => {
          if (!r.checked) return;
          this.state.moduleChoices.newModulesAnswerMode = r.value === 'mixed' ? 'mixed' : 'spelling';
          this.saveSoon();
        });
      }

      this.$.toggleKeyHintStrip.addEventListener('change', () => {
        const on = !!this.$.toggleKeyHintStrip.checked;
        this.state.moduleChoices.showKeyHintStrip = on;
        this.state.settings.showKeyHintStrip = on;
        this.renderKeyHintStrip();
        this.saveSoon();
      });

      this.$.toggleDebugMode.addEventListener('change', () => {
        window.APP_DEBUG = !!this.$.toggleDebugMode.checked;
      });

      this.$.runChecksBtn.addEventListener('click', () => this.runAutomatedChecks({ startup: false }));
      this.$.undoResetBtn.addEventListener('click', () => this.undoReset());

      // Export / Import / Reset
      this.$.exportAllBtn.addEventListener('click', () => this.exportAll());
      this.$.importAllBtn.addEventListener('click', () => this.$.importAllFile.click());
      this.$.importAllFile.addEventListener('change', (e) => this.importAllFile(e));
      this.$.resetBtn.addEventListener('click', () => this.resetAll());

      // First run close
      const closeFirstRun = () => {
        this.state.settings.firstRunSeen = true;
        this.saveSoon();
        this.closeModal(this.$.firstRunOverlay);
      };
      this.$.firstRunGotItBtn.addEventListener('click', closeFirstRun);
      this.$.firstRunCloseBtn.addEventListener('click', closeFirstRun);
      this.$.firstRunOverlay.addEventListener('click', (e) => {
        if (e.target === this.$.firstRunOverlay) closeFirstRun();
      });

      // Global keyboard with IME + input-aware behavior.
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.closeTopModal()) e.preventDefault();
          return;
        }

        if (this.isComposing || e.isComposing) return;

        const ae = document.activeElement;
        const visibleFocus = ae && (ae.offsetWidth || ae.offsetHeight || ae.getClientRects().length);
        const typing = ae && visibleFocus && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (typing) return;

        if (e.key === ' ') {
          e.preventDefault();
          this.handleRevealKey();
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.handleAdvanceKey();
          return;
        }
        if (e.key === 'ArrowLeft' && this.currentQuestion && this.currentQuestion.module === 'numbers') {
          e.preventDefault();
          this.markNeedPractice();
          return;
        }
        if (e.key === '?') {
          e.preventDefault();
          const help = document.querySelector('.help-details');
          if (help) help.open = !help.open;
          return;
        }
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          this.nextQuestion({ keepFeedback: false });
          return;
        }
        if (e.key.toLowerCase() === 'p') {
          e.preventDefault();
          if (this.currentQuestion?.module === 'numbers') this.markNeedPractice();
        }
      });
    },

    buildPools() {
      // Commands pool: one stable ID per (verb, form, pos/neg) as required schema.
      this.commandPool = [];
      for (const verb of COMMAND_VERBS) {
        for (const form of ['usted','nosotros']) {
          for (const pol of ['pos','neg']) {
            const id = `cmd-${slugify(verb)}-${form}-${pol}`;
            this.commandPool.push({ id, verb, form, pol });
          }
        }
      }

      // Reflexive pool: stable IDs conj-<verb>-present-<person>
      this.reflexivePool = [];
      this.reflexiveIdSet = new Set();
      for (const v of REFLEXIVE_VERBS) {
        for (const p of PERSONS) {
          const id = `conj-${slugify(v)}-present-${p.code}`;
          this.reflexivePool.push({ id, verb: v, tense: 'present', person: p.code });
          this.reflexiveIdSet.add(id);
        }
      }

      // Tenses pool: stable IDs conj-<verb>-<tense>-<person>
      this.tensesPool = [];
      this.tensesIdSet = new Set();
      for (const v of TENSE_VERBS) {
        for (const tense of ['present','preterite','imperfect']) {
          for (const p of PERSONS) {
            const id = `conj-${slugify(v)}-${tense}-${p.code}`;
            this.tensesPool.push({ id, verb: v, tense, person: p.code });
            this.tensesIdSet.add(id);
          }
        }
      }
    },

    refreshSettingsUI() {
      // Module toggles
      for (const m of MODULES) {
        const el = this.$['toggle_' + m.key];
        if (!el) continue;
        el.checked = !!this.state.settings.modulesEnabled[m.key];
      }
      if (this.$.toggle_mayo_madness) this.$.toggle_mayo_madness.checked = !!(this.hasPremiumAccess() && this.state.settings.mayoMadnessEnabled);

      // Tense toggles
      this.$.tense_present.checked = !!this.state.settings.tensesEnabled.present;
      this.$.tense_preterite.checked = !!this.state.settings.tensesEnabled.preterite;
      this.$.tense_imperfect.checked = !!this.state.settings.tensesEnabled.imperfect;
      this.$.tense_irregular_only.checked = !!this.state.settings.tensesIrregularOnly;

      const numbersRange = this.getNumbersRange();
      this.state.settings.numbersMin = numbersRange.min;
      this.state.settings.numbersMax = numbersRange.max;
      this.$.numbersMinRange.value = String(numbersRange.min);
      this.$.numbersMinInput.value = String(numbersRange.min);
      this.$.numbersMinValue.textContent = String(numbersRange.min);
      this.$.numbersMaxRange.value = String(numbersRange.max);
      this.$.numbersMaxInput.value = String(numbersRange.max);
      this.$.numbersMaxValue.textContent = String(numbersRange.max);
      this.$.numbersRequireTyping.checked = !!this.state.settings.numbersRequireTyping;
      this.$.numbersSequential.checked = !!this.state.settings.numbersSequential;
      this.updateNumbersRangeText();

      // Vocab mode
      if (this.state.settings.vocabMode === 'uniform') this.$.vocab_uniform.checked = true;
      else this.$.vocab_weighted.checked = true;
      this.$.prioritizeWeakQuestions.checked = this.state.settings.prioritizeWeakQuestions !== false;

      this.$.practiceMixRange.value = String(this.state.moduleChoices.practiceMix ?? 50);
      this.$.practiceMixValue.textContent = String(this.state.moduleChoices.practiceMix ?? 50);
      const newMode = this.state.moduleChoices.newModulesAnswerMode === 'mixed' ? 'mixed' : 'spelling';
      if (newMode === 'mixed') this.$.newModulesMode_mixed.checked = true;
      else this.$.newModulesMode_spelling.checked = true;
      this.$.toggleKeyHintStrip.checked = !!this.state.moduleChoices.showKeyHintStrip;
      this.$.toggleDebugMode.checked = !!window.APP_DEBUG;

      // Enable/disable solo buttons based on enabled modules
      this.refreshPremiumAccessUI();
      this.updateSoloButtonsDisabled();
    },

    updateSoloButtonsDisabled() {
      this.$.soloNumbersBtn.disabled = !this.isModulePracticeEnabled('numbers');
      this.$.soloCommandsBtn.disabled = !this.isModulePracticeEnabled('commands');
      this.$.soloVocabBtn.disabled = !this.isModulePracticeEnabled('vocab');
      this.$.soloMayoMadnessBtn.disabled = !this.isModulePracticeEnabled(MAYO_MADNESS_KEY);
      this.$.soloMayoMadness1Btn.disabled = !this.isModulePracticeEnabled('mayo_madness_1');
      this.$.soloMayoMadness2Btn.disabled = !this.isModulePracticeEnabled('mayo_madness_2');
      this.$.soloRapidTranslations2Btn.disabled = !this.isModulePracticeEnabled('rapid_translations_2');
      this.$.soloRapidRegularVerbsBtn.disabled = !this.isModulePracticeEnabled('rapid_regular_verbs');
      this.$.soloRapidIrregularVerbsBtn.disabled = !this.isModulePracticeEnabled('rapid_irregular_verbs');
      this.$.soloMayoMadness3RapidTranslationsBtn.disabled = !this.isModulePracticeEnabled('mayo_madness_3_rapid_translations');
      this.$.soloReflexiveBtn.disabled = !this.isModulePracticeEnabled('reflexive');
      this.$.soloTensesBtn.disabled = !this.isModulePracticeEnabled('tenses');
      this.$.soloDaysBtn.disabled = !this.isModulePracticeEnabled('days');
      this.$.soloMonthsBtn.disabled = !this.isModulePracticeEnabled('months');
      this.$.soloSeasonsBtn.disabled = !this.isModulePracticeEnabled('seasons');
      this.$.soloTimeBtn.disabled = !this.isModulePracticeEnabled('time');
      this.$.soloColorsBtn.disabled = !this.isModulePracticeEnabled('colors');
      this.$.soloPricesBtn.disabled = !this.isModulePracticeEnabled('prices');
      this.$.soloWeatherBtn.disabled = !this.isModulePracticeEnabled('weather');
      this.$.soloClothingBtn.disabled = !this.isModulePracticeEnabled('clothing');
      this.$.soloFoodsBtn.disabled = !this.isModulePracticeEnabled('foods');
      this.$.soloPresentProgressiveBtn.disabled = !this.isModulePracticeEnabled('present_progressive');
      this.$.soloSerEstarBtn.disabled = !this.isModulePracticeEnabled('ser_estar');
      this.$.soloGustarBtn.disabled = !this.isModulePracticeEnabled('gustar');
      this.$.soloDatesBtn.disabled = !this.isModulePracticeEnabled('dates');
      this.$.soloHonorsOrdinalBtn.disabled = !this.isModulePracticeEnabled('honors_ordinal_numbers');
      this.$.soloHonorsTest1Btn.disabled = !this.isModulePracticeEnabled('honors_test1_review');
    },

    renderKeyHintStrip() {
      const visible = !!this.state.moduleChoices.showKeyHintStrip;
      this.$.keyHintStrip.style.display = visible ? '' : 'none';
    },

    isNewModulesSpellingOnly() {
      return (this.state.moduleChoices.newModulesAnswerMode || 'spelling') === 'spelling';
    },

    getNumbersRange() {
      return normalizeNumberRange(this.state.settings.numbersMin, this.state.settings.numbersMax);
    },

    applyNumbersRangeFromControls(source) {
      const readValue = (rangeEl, inputEl, fallback, preferInput) => {
        const raw = preferInput ? inputEl.value : rangeEl.value;
        if (preferInput && raw.trim() === '') return null;
        return clampNumberBound(raw, fallback);
      };
      const minFromInput = source === 'minInput';
      const maxFromInput = source === 'maxInput';
      const min = readValue(this.$.numbersMinRange, this.$.numbersMinInput, 1, minFromInput);
      const max = readValue(this.$.numbersMaxRange, this.$.numbersMaxInput, 1000, maxFromInput);
      if (min == null || max == null) return;

      this.state.settings.numbersMin = min;
      this.state.settings.numbersMax = max;
      const range = this.getNumbersRange();
      this.$.numbersMinRange.value = String(min);
      this.$.numbersMaxRange.value = String(max);
      if (source !== 'minInput') this.$.numbersMinInput.value = String(min);
      if (source !== 'maxInput') this.$.numbersMaxInput.value = String(max);
      this.$.numbersMinValue.textContent = String(range.min);
      this.$.numbersMaxValue.textContent = String(range.max);
      this.updateNumbersRangeText();
      this.saveSoon();
      this.updateCountsRow();
    },

    ensureCurrentNumberInRange() {
      const range = this.getNumbersRange();
      if (this.currentQuestion && this.currentQuestion.module === 'numbers' && (this.currentQuestion.number < range.min || this.currentQuestion.number > range.max)) {
        this.nextQuestion({ forceModule: 'numbers', keepFeedback: false });
      }
    },

    updateNumbersRangeText() {
      const { min, max } = this.getNumbersRange();
      const rangeText = `${min}-${max}`;
      if (this.$.numbersTitle) this.$.numbersTitle.textContent = `Random Number (${rangeText})`;
      if (this.$.numbersLead) {
        this.$.numbersLead.innerHTML = this.state.settings.numbersRequireTyping
          ? `Type the Spanish spelling for numbers from <strong>${rangeText}</strong>${this.state.settings.numbersSequential ? ', in order' : ''}.`
          : `Reveal the Spanish spelling for <strong>${rangeText}</strong>${this.state.settings.numbersSequential ? ', in order' : ''}.`;
      }
    },

    openSettings() {
      this.refreshSettingsUI();
      this.updateHiddenCountLabel();
      this.openModal(this.$.settingsOverlay, this.$.toggle_numbers || this.$.settingsCloseBtn);
    },

    openHiddenManager() {
      this.rebuildHiddenList();
      this.openModal(this.$.hiddenOverlay, this.$.hiddenCloseBtn);
    },

    openModal(overlay, focusEl) {
      this.lastFocus = document.activeElement;
      overlay.style.display = 'flex';
      // Basic focus management
      setTimeout(() => {
        (focusEl || overlay.querySelector('button, input, [tabindex]:not([tabindex="-1"])'))?.focus?.();
      }, 0);
    },

    closeModal(overlay) {
      overlay.style.display = 'none';
      // Return focus
      if (this.lastFocus && this.lastFocus.focus) {
        setTimeout(() => this.lastFocus.focus(), 0);
      }
    },

    closeTopModal() {
      // Close in priority order
      const modals = [
        this.$.hiddenOverlay,
        this.$.endSessionOverlay,
        this.$.feedbackOverlay,
        this.$.premiumOverlay,
        this.$.settingsOverlay,
        this.$.numbersGuideOverlay,
        this.$.firstRunOverlay
      ];
      for (const m of modals) {
        if (m.style.display === 'flex') {
          this.closeModal(m);
          return true;
        }
      }
      return false;
    },

    isModulePracticeEnabled(moduleKey) {
      if (moduleKey === MAYO_MADNESS_KEY) return this.getEnabledMayoMadnessModules().length > 0;
      if (!this.state.settings.modulesEnabled[moduleKey]) return false;
      if (!isMayoMadnessKey(moduleKey)) return true;
      return !!(this.hasPremiumAccess() && this.state.settings.mayoMadnessEnabled);
    },

    getEnabledMayoMadnessModules() {
      if (!this.hasPremiumAccess() || !this.state.settings.mayoMadnessEnabled) return [];
      return MAYO_MADNESS_SUBMODULE_KEYS.filter((key) => this.state.settings.modulesEnabled[key] && this.getModuleCounts(key).available > 0);
    },

    refreshPremiumAccessUI() {
      const unlocked = this.hasPremiumAccess();
      const parentOn = !!this.state.settings.mayoMadnessEnabled;
      if (this.$.premiumBtn) {
        this.$.premiumBtn.classList.toggle('unlocked', unlocked);
        const temporary = this.premiumAccessMode === 'temporary';
        this.$.premiumBtn.title = unlocked ? (temporary ? 'Premium active for one day' : 'Premium active') : 'Unlock Premium';
        this.$.premiumBtn.setAttribute('aria-label', unlocked ? (temporary ? 'Premium active for one day' : 'Premium active') : 'Unlock Premium');
      }
      if (this.$.toggle_mayo_madness) {
        this.$.toggle_mayo_madness.checked = unlocked && parentOn;
        this.$.toggle_mayo_madness.disabled = !unlocked;
      }
      if (this.$.mayoLockedNote) this.$.mayoLockedNote.style.display = unlocked ? 'none' : '';
      if (this.$.mayoSubmoduleList) this.$.mayoSubmoduleList.style.display = unlocked ? '' : 'none';

      const mayoButtons = [
        this.$.soloMayoMadnessBtn,
        this.$.soloMayoMadness1Btn,
        this.$.soloMayoMadness2Btn,
        this.$.soloRapidTranslations2Btn,
        this.$.soloRapidRegularVerbsBtn,
        this.$.soloRapidIrregularVerbsBtn,
        this.$.soloMayoMadness3RapidTranslationsBtn
      ].filter(Boolean);
      for (const btn of mayoButtons) btn.style.display = unlocked ? '' : 'none';

      const mayoOptions = this.$.soloSelect ? Array.from(this.$.soloSelect.options).filter((opt) => opt.value === MAYO_MADNESS_KEY || isMayoMadnessKey(opt.value)) : [];
      for (const opt of mayoOptions) {
        opt.disabled = !unlocked;
        opt.hidden = !unlocked;
      }

      for (const key of MAYO_MADNESS_SUBMODULE_KEYS) {
        const el = this.$['toggle_' + key];
        if (el) el.disabled = !unlocked;
      }
    },

    loadPremiumAccess() {
      const record = readPremiumAccessRecord();
      if (!record) {
        clearPremiumAccessRecord();
        this.mayoPremiumUnlocked = false;
        this.premiumAccessMode = null;
        this.premiumAccessExpiresAt = 0;
        return;
      }
      this.mayoPremiumUnlocked = true;
      this.premiumAccessMode = record.mode;
      this.premiumAccessExpiresAt = record.expiresAt;
    },

    hasPremiumAccess() {
      if (!this.mayoPremiumUnlocked) return false;
      if (this.premiumAccessMode === 'temporary' && this.premiumAccessExpiresAt <= Date.now()) {
        this.mayoPremiumUnlocked = false;
        this.premiumAccessMode = null;
        this.premiumAccessExpiresAt = 0;
        clearPremiumAccessRecord();
        return false;
      }
      return true;
    },

    isQuestionAvailableWithoutPremium(question) {
      return !question || !isPremiumQuestion(question.module, question.id) || this.hasPremiumAccess();
    },

    openPremiumAccess() {
      this.$.premiumPasswordInput.value = '';
      this.$.premiumRequestForm.reset();
      this.$.premiumRequestForm.hidden = true;
      this.$.premiumRequestFeedback.textContent = '';
      const unlocked = this.hasPremiumAccess();
      const status = this.premiumAccessMode === 'temporary' ? ' for today' : '';
      this.setPremiumFeedback(unlocked ? `Premium is already active${status}.` : 'Unlock advanced materials and the full question pools.', unlocked ? 'good' : 'neutral');
      this.openModal(this.$.premiumOverlay, this.$.premiumPasswordInput);
    },

    async submitPremiumRequest(event) {
      event.preventDefault();
      const form = this.$.premiumRequestForm;
      const submit = this.$.premiumRequestSubmit;
      const status = this.$.premiumRequestFeedback;
      if (!form.reportValidity()) return;
      if (!TALLY_PREMIUM_URL) {
        status.className = 'feedback bad';
        status.textContent = 'Tally is not connected yet. Add the premium form URL in app.js.';
        return;
      }
      openTallyForm(TALLY_PREMIUM_URL, {
        form_type: 'premium_access_request',
        app_name: 'claro',
        name: this.$.premiumRequestName.value.trim(),
        email: this.$.premiumRequestEmail.value.trim(),
        source: 'premium_modal',
        current_level: this.currentLevel === 'spanish2' ? 'Spanish 2' : 'Spanish 1',
        current_module: this.currentQuestion?.module || 'dashboard',
        page_url: window.location.href
      });
      status.className = 'feedback good';
      status.textContent = 'Tally opened in a new tab. Submit your request there.';
      return;
      /* legacy provider path retained below for easy rollback */
      submit.disabled = true;
      status.className = 'feedback neutral';
      status.textContent = 'Sending your request…';
      try {
        const formData = new FormData(form);
        const response = await fetch(form.action, {
          method: 'POST',
          body: formData,
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) throw new Error('Request failed');
        status.className = 'feedback good';
        status.textContent = 'Request sent. We’ll discuss access by email.';
        form.reset();
      } catch (error) {
        status.className = 'feedback bad';
        status.textContent = 'Could not send the request. Please try again.';
      } finally {
        submit.disabled = false;
      }
    },

    setPremiumFeedback(html, tone) {
      this.$.premiumFeedback.className = `feedback ${tone || 'neutral'}`;
      this.$.premiumFeedback.innerHTML = html;
    },

    submitPremiumPassword() {
      const password = this.$.premiumPasswordInput.value.trim();
      const temporary = false;
      if (MAYO_MADNESS_PASSWORDS.has(password) || temporary) {
        this.mayoPremiumUnlocked = true;
        this.premiumAccessMode = temporary ? 'temporary' : 'permanent';
        this.premiumAccessExpiresAt = temporary ? Date.now() + PREMIUM_ACCESS_DAY : 0;
        writePremiumAccessRecord({ mode: this.premiumAccessMode, expiresAt: this.premiumAccessExpiresAt });
        this.setPremiumFeedback(temporary ? 'Premium unlocked for 1 day.' : 'Premium unlocked and saved on this device.', 'good');
        this.closeModal(this.$.premiumOverlay);
        this.refreshSettingsUI();
        this.updateCountsRow();
        this.showBanner(temporary ? 'Premium unlocked for <strong>1 day</strong>.' : 'Premium unlocked: advanced materials are now available.');
        return;
      }
      this.setPremiumFeedback('Incorrect password. Try again.', 'bad');
      this.$.premiumPasswordInput.select();
    },

    openFeedback() {
      this.$.feedbackForm.reset();
      this.updateFeedbackTypeUI();
      this.setFeedbackStatus('Your feedback will be sent securely.', 'neutral');
      this.openModal(this.$.feedbackOverlay, this.$.feedbackMessage);
    },

    updateFeedbackTypeUI() {
      const requestingModule = this.$.feedbackType.value === 'module_request';
      this.$.feedbackModuleRequestField.hidden = !requestingModule;
      this.$.feedbackModuleRequest.required = requestingModule;
      this.$.feedbackMessage.placeholder = requestingModule
        ? 'What would you want to practice in this module, and what would make it useful?'
        : 'What should be improved?';
    },

    setFeedbackStatus(message, tone = 'neutral') {
      this.$.feedbackStatus.className = `feedback ${tone}`;
      this.$.feedbackStatus.textContent = message;
    },

    async submitFeedback(event) {
      event.preventDefault();
      const message = this.$.feedbackMessage.value.trim();
      const email = this.$.feedbackEmail.value.trim();
      const feedbackType = this.$.feedbackType.value;
      const requestedModule = this.$.feedbackModuleRequest.value.trim();
      if (!message) {
        this.setFeedbackStatus('Please write a little feedback first.', 'bad');
        this.$.feedbackMessage.focus();
        return;
      }
      if (feedbackType === 'module_request' && !requestedModule) {
        this.setFeedbackStatus('Please name the module you would like to request.', 'bad');
        this.$.feedbackModuleRequest.focus();
        return;
      }
      if (!TALLY_FEEDBACK_URL) {
        this.setFeedbackStatus('Tally is not connected yet. Add the feedback form URL in app.js.', 'bad');
        return;
      }
      const tallyMessage = feedbackType === 'module_request'
        ? `Requested module: ${requestedModule}\n\n${message}`
        : message;
      openTallyForm(TALLY_FEEDBACK_URL, {
        form_type: 'feedback',
        app_name: 'claro',
        feedback_type: tallyFeedbackType(feedbackType),
        requested_module: requestedModule,
        message: tallyMessage,
        email,
        level: this.currentLevel === 'spanish2' ? 'Spanish 2' : 'Spanish 1',
        module: this.currentQuestion?.module || 'dashboard',
        source: 'feedback_button',
        dashboard: this.currentLevel === 'spanish2' ? 'Spanish 2 Honors' : 'Spanish 1',
        page_url: window.location.href
      });
      this.setFeedbackStatus('Tally opened in a new tab. Submit your feedback there.', 'good');
      return;
      const submit = this.$.feedbackSubmitBtn;
      submit.disabled = true;
      submit.textContent = 'Sending…';
      this.setFeedbackStatus('Sending feedback…', 'neutral');
      try {
        const formData = new FormData(this.$.feedbackForm);
        formData.append('_subject', `Claro feedback · ${this.currentLevel || 'Spanish 1'}`);
        formData.append('level', this.currentLevel || 'spanish1');
        formData.append('module', this.currentQuestion?.module || 'dashboard');
        formData.append('url', window.location.href);
        const response = await fetch(this.$.feedbackForm.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: formData
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Unable to send feedback.');
        this.$.feedbackForm.reset();
        this.setFeedbackStatus('Thanks — your feedback was sent.', 'good');
      } catch (error) {
        this.setFeedbackStatus(error.message || 'Could not send feedback. Please try again.', 'bad');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Send feedback';
      }
    },

    // --------------------------------------------
    // Availability / edge-case auto-disable
    // --------------------------------------------
    anyTenseEnabled() {
      const t = this.state.settings.tensesEnabled;
      return !!(t.present || t.preterite || t.imperfect);
    },

    isTenseItemAllowed(item) {
      if (!item) return false;
      if (!this.state.settings.tensesEnabled[item.tense]) return false;
      if (!this.state.settings.tensesIrregularOnly) return true;
      return isIrregularForTense(item.verb, item.tense);
    },

    anyModuleEnabled() {
      return this.getEnabledModules().length > 0;
    },

    isModuleInCurrentLevel(module) {
      return this.currentLevel === 'spanish2' ? module.level === 2 : module.level !== 2;
    },

    getEnabledModules() {
      const list = MODULES.filter(m => this.isModuleInCurrentLevel(m)).map(m => m.key).filter(k => this.isModulePracticeEnabled(k));

      if (this.soloMode === MAYO_MADNESS_KEY) {
        const mayoList = this.getEnabledMayoMadnessModules();
        if (mayoList.length) return mayoList;
        this.soloMode = null;
      }
      if (this.soloMode && this.isModulePracticeEnabled(this.soloMode)) return [this.soloMode];
      if (this.soloMode && !this.isModulePracticeEnabled(this.soloMode)) this.soloMode = null;

      return list;
    },

    ensureModuleAvailability() {
      // If a module has 0 available items, auto-disable it and notify.
      const messages = [];

      // Vocab can be empty if parsing/filtering removes everything.
      const counts = Object.fromEntries(MODULES.map((m) => [m.key, this.getModuleCounts(m.key)]));

      for (const m of MODULES) {
        const key = m.key;
        if (!this.state.settings.modulesEnabled[key]) continue;

        if (key === 'tenses' && !this.anyTenseEnabled()) {
          this.state.settings.tensesEnabled.present = true;
          this.$.tense_present.checked = true;
          messages.push('Tenses module had no tenses selected. Present was re-enabled.');
          continue;
        }

        if (counts[key].available === 0) {
          this.state.settings.modulesEnabled[key] = false;
          if (key === 'vocab' && counts[key].total === 0) {
            messages.push('Honors Vocab was auto-disabled because all entries overlap with dedicated modules or were filtered out.');
          } else {
            messages.push(`${m.name} was auto-disabled because it has 0 available items (all hidden, filtered out, or not configured).`);
          }
        }
      }

      this.updateSoloButtonsDisabled();
      this.refreshSettingsUI();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
      this.saveSoon();

      if (messages.length) {
        this.showBanner(`<strong>Heads up:</strong><br>${messages.map(m => '• ' + m).join('<br>')}<br><small>Use “Restore hidden” to bring items back.</small>`);
      }

      // If everything is disabled, re-enable Numbers if possible.
      if (!this.anyModuleEnabled()) {
        if (counts.numbers.available > 0) {
          this.state.settings.modulesEnabled.numbers = true;
          this.saveSoon();
          const { min, max } = this.getNumbersRange();
          this.showBanner(`All modules were disabled. Numbers (${min}-${max}) was re-enabled.`);
        } else {
          this.showBanner('<strong>No practice items available.</strong> You appear to have hidden everything. Restore some hidden questions.');
        }
      }
    },

    getModuleCounts(moduleKey) {
      const hidden = this.state.hiddenItems;

      if (moduleKey === 'numbers') {
        const { min, max } = this.getNumbersRange();
        const total = max - min + 1;
        const hiddenCount = Object.keys(hidden).filter((k) => {
          if (!k.startsWith('number-')) return false;
          const n = parseInt(k.replace('number-', ''), 10);
          return Number.isFinite(n) && n >= min && n <= max;
        }).length;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'vocab') {
        const total = this.vocab.length;
        let hiddenCount = 0;
        for (const v of this.vocab) if (hidden[v.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'commands') {
        const total = this.commandPool.length;
        let hiddenCount = 0;
        for (const c of this.commandPool) if (hidden[c.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'reflexive') {
        const total = this.reflexivePool.length;
        let hiddenCount = 0;
        for (const q of this.reflexivePool) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'tenses') {
        // Only count tenses currently enabled
        const totalAll = this.tensesPool.filter(q => this.isTenseItemAllowed(q)).length;
        let hiddenCount = 0;
        for (const q of this.tensesPool) {
          if (!this.isTenseItemAllowed(q)) continue;
          if (hidden[q.id]) hiddenCount++;
        }
        return { total: totalAll, available: Math.max(0, totalAll - hiddenCount) };
      }

      if (moduleKey === 'days') {
        const total = DAYS_POOL.length;
        let hiddenCount = 0;
        for (const q of DAYS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'mayo_madness_1') {
        const total = MAYO_MADNESS_LEVEL_1_POOL.length;
        let hiddenCount = 0;
        for (const q of MAYO_MADNESS_LEVEL_1_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'mayo_madness_2') {
        const total = MAYO_MADNESS_LEVEL_2_POOL.length;
        let hiddenCount = 0;
        for (const q of MAYO_MADNESS_LEVEL_2_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'rapid_translations_2') {
        const total = RAPID_TRANSLATIONS_LEVEL_2_POOL.length;
        let hiddenCount = 0;
        for (const q of RAPID_TRANSLATIONS_LEVEL_2_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'rapid_regular_verbs') {
        const total = RAPID_REGULAR_VERB_POOL.length;
        let hiddenCount = 0;
        for (const q of RAPID_REGULAR_VERB_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'rapid_irregular_verbs') {
        const total = RAPID_IRREGULAR_VERB_POOL.length;
        let hiddenCount = 0;
        for (const q of RAPID_IRREGULAR_VERB_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'mayo_madness_3_rapid_translations') {
        const total = MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL.length;
        let hiddenCount = 0;
        for (const q of MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'months') {
        const total = MONTHS_POOL.length;
        let hiddenCount = 0;
        for (const q of MONTHS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'seasons') {
        const total = SEASONS_POOL.length;
        let hiddenCount = 0;
        for (const q of SEASONS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'time') {
        const total = TIME_POOL.length;
        let hiddenCount = 0;
        for (const q of TIME_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'colors') {
        const total = COLORS_POOL.length;
        let hiddenCount = 0;
        for (const q of COLORS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'prices') {
        const total = PRICES_POOL.length;
        let hiddenCount = 0;
        for (const q of PRICES_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'weather') {
        const total = WEATHER_POOL.length;
        let hiddenCount = 0;
        for (const q of WEATHER_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'clothing') {
        const total = CLOTHING_POOL.length;
        let hiddenCount = 0;
        for (const q of CLOTHING_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'foods') {
        const total = FOODS_POOL.length;
        let hiddenCount = 0;
        for (const q of FOODS_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'present_progressive') {
        const total = PRESENT_PROGRESSIVE_POOL.length;
        let hiddenCount = 0;
        for (const q of PRESENT_PROGRESSIVE_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'ser_estar') {
        const total = SER_ESTAR_POOL.length;
        let hiddenCount = 0;
        for (const q of SER_ESTAR_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'gustar') {
        const total = GUSTAR_POOL.length;
        let hiddenCount = 0;
        for (const q of GUSTAR_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }
      if (moduleKey === 'dates') {
        const total = DATES_POOL.length;
        let hiddenCount = 0;
        for (const q of DATES_POOL) if (hidden[q.id]) hiddenCount++;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      if (moduleKey === 'honors_ordinal_numbers' || moduleKey === 'honors_test1_review') {
        const pool = moduleKey === 'honors_ordinal_numbers'
          ? ORDINAL_POOL
          : HONORS_PRETERITE_POOL.concat(HONORS_IMPERFECT_POOL, HONORS_TIME_WORDS, HONORS_CHOICE_POOL);
        const hiddenCount = pool.filter(item => hidden[item.id]).length;
        return { total: pool.length, available: Math.max(0, pool.length - hiddenCount) };
      }

      const summerPool = {
        summer_time_words: SUMMER_TIME_WORDS_POOL,
        summer_preterite: SUMMER_PRETERITE_POOL,
        summer_imperfect: SUMMER_IMPERFECT_POOL,
        summer_irregular_preterite: SUMMER_IRREGULAR_PRETERITE_POOL,
        summer_irregular_imperfect: SUMMER_IRREGULAR_IMPERFECT_POOL,
        summer_tense_choice: SUMMER_TENSE_CHOICE_POOL,
        summer_translations: SUMMER_TRANSLATIONS_POOL
      }[moduleKey];
      if (summerPool) {
        const total = summerPool.length;
        const hiddenCount = summerPool.filter(item => hidden[item.id]).length;
        return { total, available: Math.max(0, total - hiddenCount) };
      }

      return { total: 0, available: 0 };
    },

    enterPractice() {
      if (this.currentLevel === 'spanish2' && !this.getEnabledModules().length) {
        this.openSettings();
        return;
      }
      this.$.homeCard.style.display = 'none';
      this.$.mainCard.style.display = 'block';
      document.body.classList.remove('home-mode');
      document.body.classList.add('practice-mode');
      this.$.mainCard.classList.add('is-entering');
      setTimeout(() => this.$.mainCard.classList.remove('is-entering'), 260);
      this.currentQuestion = null;
      this.currentNumber = null;
      this.practiceRequested = false;
      this.numbersStatus = '';
      this.startPracticeSession();
      this.nextQuestion({ keepFeedback: false });
      this.$.revealBtn?.focus?.();
    },

    setLevel(level, { historyMode = 'replace' } = {}) {
      this.currentLevel = level === 'spanish2' ? 'spanish2' : 'spanish1';
      const url = new URL(window.location.href);
      url.searchParams.set('class', this.currentLevel);
      if (historyMode === 'push') window.history.pushState({ class: this.currentLevel }, '', url);
      if (historyMode === 'replace') window.history.replaceState({ class: this.currentLevel }, '', url);
      this.updateDocumentTitle();
      if (this.state) {
        this.state.lastLevel = this.currentLevel;
        persistLastView({ level: this.currentLevel, module: this.state.lastModule || this.soloMode || null });
        this.saveSoon();
      }
      const spanish2 = this.currentLevel === 'spanish2';
      const summerModules = MODULES.filter(m => m.level === 2);
      const enabledSummerModules = summerModules.filter(m => this.state?.settings?.modulesEnabled?.[m.key]);
      this.$.headerLevel.textContent = spanish2 ? 'Spanish 2 Honors' : 'Spanish 1';
      const classSwitcherLabel = document.getElementById('classSwitcherLabel');
      if (classSwitcherLabel) classSwitcherLabel.textContent = spanish2 ? 'Spanish 2 Honors' : 'Spanish 1';
      document.querySelectorAll('#classSwitcherMenu [data-class]').forEach((option) => { const current = option.dataset.class === this.currentLevel; option.classList.toggle('is-current', current); option.setAttribute('aria-current', current ? 'page' : 'false'); });
      this.$.spanish1Tab.classList.toggle('is-active', !spanish2);
      this.$.spanish2Tab.classList.toggle('is-active', spanish2);
      this.$.spanish1Tab.setAttribute('aria-selected', String(!spanish2));
      this.$.spanish2Tab.setAttribute('aria-selected', String(spanish2));
      this.$.spanish1Panel.hidden = spanish2;
      this.$.spanish2Panel.hidden = !spanish2;
      document.body.classList.toggle('level-spanish1', !spanish2);
      document.body.classList.toggle('level-spanish2', spanish2);
      if (this.$.settingsIntro) {
        this.$.settingsIntro.textContent = spanish2
          ? 'Spanish 2 Honors modules. Choose only the drills you want today.'
          : 'Spanish 1 modules. Choose only the topics you want today.';
      }
      this.$.enterPracticeBtn.disabled = spanish2 && enabledSummerModules.length === 0;
      this.$.enterPracticeBtn.textContent = spanish2
        ? (enabledSummerModules.length ? 'Enter Spanish 2 Honors →' : 'Enable Spanish 2 Honors modules')
        : 'Enter practice session →';
      this.$.enterPracticeBtn.setAttribute('aria-label', spanish2
        ? (enabledSummerModules.length ? 'Enter Spanish 2 Honors' : 'Enable Spanish 2 Honors modules')
        : 'Enter practice session');
      if (this.$.spanish2ModuleSummary) {
        this.$.spanish2ModuleSummary.textContent = enabledSummerModules.length
          ? enabledSummerModules.map(m => m.name).join(', ')
          : 'No Spanish 2 Honors modules enabled yet';
      }
    },

    updateDocumentTitle() {
      document.title = this.currentLevel === 'spanish2'
        ? 'Claro — Spanish 2 Honors'
        : 'Claro — Spanish 1';
    },

    ensureProfileAndAnalytics() {
      const profileId = this.state.profileId || readProfileId() || createProfileId();
      this.state.profileId = profileId;
      persistProfileId(profileId);
      this.state.practiceSessions = Array.isArray(this.state.practiceSessions) ? this.state.practiceSessions : [];
      this.state.lifetimeStats = this.state.lifetimeStats || { answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
    },

    formatPercent(correct, total) {
      return total ? `${Math.round((correct / total) * 100)}%` : '0%';
    },

    startPracticeSession() {
      this.activeSession = {
        id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level: this.currentLevel === 'spanish2' ? 'spanish2' : 'spanish1',
        startedAt: new Date().toISOString(),
        answered: 0,
        correct: 0,
        incorrect: 0,
        currentStreak: 0,
        bestStreak: 0,
        modules: new Set(),
        sectionCounts: { preterite: 0, imperfect: 0, vocabulary: 0, translation: 0, choice: 0 },
        target: this.getSessionTarget()
      };
      this.sessionQuestionRecorded = false;
      this.updateSessionStatsUI();
    },

    getSessionTarget() {
      const premium = this.hasPremiumAccess();
      const enabled = this.getEnabledModules();
      if (enabled.length === 1 && enabled[0] === 'honors_ordinal_numbers') return premium ? 14 : 8;
      if (enabled.includes('honors_test1_review')) return premium ? 24 : 16;
      return null;
    },

    recordSessionAnswer(correct) {
      if (!this.activeSession || this.sessionQuestionRecorded) return;
      this.sessionQuestionRecorded = true;
      const session = this.activeSession;
      session.answered += 1;
      if (correct) {
        session.correct += 1;
        session.currentStreak += 1;
        session.bestStreak = Math.max(session.bestStreak, session.currentStreak);
        if ([3, 5, 10, 15, 20].includes(session.currentStreak) || (session.currentStreak > 20 && session.currentStreak % 5 === 0)) {
          this.celebrateStreak();
        }
      } else {
        session.incorrect += 1;
        session.currentStreak = 0;
      }
      if (this.currentQuestion?.module) session.modules.add(this.currentQuestion.module);

      const lifetime = this.state.lifetimeStats;
      lifetime.answered += 1;
      if (correct) {
        lifetime.correct += 1;
        lifetime.currentStreak += 1;
        lifetime.bestStreak = Math.max(lifetime.bestStreak, lifetime.currentStreak);
      } else {
        lifetime.currentStreak = 0;
      }
      this.updateSessionStatsUI();
      this.updateDashboardAnalyticsUI();
      this.saveSoon();
    },

    celebrateStreak() {
      const streakCard = this.$?.sessionStreak?.closest('.session-stat-streak');
      if (!streakCard) return;
      const sessionStats = this.$?.sessionStats;
      sessionStats?.classList.remove('streak-active');
      requestAnimationFrame(() => sessionStats?.classList.add('streak-active'));
      streakCard.classList.remove('streak-flare');
      requestAnimationFrame(() => streakCard.classList.add('streak-flare'));
      setTimeout(() => {
        streakCard.classList.remove('streak-flare');
        sessionStats?.classList.remove('streak-active');
      }, 1950);
    },

    updateSessionStatsUI() {
      const session = this.activeSession;
      if (!this.$?.sessionStats) return;
      this.$.sessionStats.style.display = session ? 'grid' : 'none';
      if (!session) return;
      this.$.sessionCorrect.textContent = String(session.correct);
      this.$.sessionIncorrect.textContent = String(session.incorrect);
      this.$.sessionAnswered.textContent = String(session.answered);
      this.$.sessionAccuracy.textContent = this.formatPercent(session.correct, session.answered);
      this.$.sessionStreak.textContent = String(session.currentStreak);
    },

    requestEndSession() {
      if (!this.activeSession) {
        this.returnHome();
        return;
      }
      const session = this.activeSession;
      const accuracy = this.formatPercent(session.correct, session.answered);
      this.$.endSessionSummary.innerHTML = `<strong>${session.correct} correct</strong> · ${session.incorrect} incorrect · ${session.answered} answered · ${accuracy} accuracy`;
      this.openModal(this.$.endSessionOverlay, this.$.continueSessionBtn);
    },

    resumePracticeSession() {
      this.closeModal(this.$.endSessionOverlay);
      document.body.classList.remove('home-mode');
      document.body.classList.add('practice-mode');
      if (this.currentQuestion?.mode === 'text') this.$.answerInput?.focus?.();
      else this.$.revealBtn?.focus?.();
    },

    finishPracticeSession() {
      if (!this.activeSession) return;
      const session = this.activeSession;
      const endedAt = new Date();
      const startedAt = new Date(session.startedAt);
      this.state.practiceSessions.push({
        id: session.id,
        level: session.level,
        startedAt: session.startedAt,
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
        answered: session.answered,
        correct: session.correct,
        incorrect: session.incorrect,
        bestStreak: session.bestStreak,
        modules: Array.from(session.modules)
      });
      this.state.practiceSessions = this.state.practiceSessions.slice(-50);
      this.activeSession = null;
      this.sessionQuestionRecorded = false;
      this.currentQuestion = null;
      this.closeModal(this.$.endSessionOverlay);
      saveState(this.state);
      this.updateSessionStatsUI();
      this.returnHome();
    },

    updateDashboardAnalyticsUI() {
      if (!this.$?.allTimeAccuracy || !this.state) return;
      const stats = this.state.lifetimeStats || { answered: 0, correct: 0, currentStreak: 0, bestStreak: 0 };
      this.$.allTimeAccuracy.textContent = this.formatPercent(stats.correct, stats.answered);
      this.$.allTimeCorrect.textContent = String(stats.correct);
      this.$.allTimeAnsweredLabel.textContent = `of ${stats.answered} answered`;
      this.$.allTimeCurrentStreak.textContent = String(stats.currentStreak);
      this.$.allTimeBestStreak.textContent = String(stats.bestStreak);
      this.$.allTimeSessions.textContent = String(this.state.practiceSessions.length);
      this.$.profileNote.textContent = this.state.profileId ? 'Saved in this browser' : 'Local progress';
      this.renderSessionHistory();
    },

    renderSessionHistory() {
      const list = this.$?.sessionHistory;
      const empty = this.$?.sessionHistoryEmpty;
      if (!list || !empty || !this.state) return;
      list.innerHTML = '';
      const sessions = [...(this.state.practiceSessions || [])].reverse();
      empty.style.display = sessions.length ? 'none' : '';
      for (const session of sessions) {
        const row = document.createElement('article');
        row.className = 'session-history-row';
        const date = new Date(session.endedAt || session.startedAt);
        const dateLabel = Number.isNaN(date.getTime()) ? 'Practice session' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
        const levelLabel = session.level === 'spanish2' ? 'Spanish 2 · Honors' : 'Spanish 1';
        const modules = session.modules?.length ? session.modules.join(', ') : 'All enabled modules';
        row.innerHTML = `<div class="session-history-main"><strong>${levelLabel}</strong><small>${dateLabel}</small><small>${modules}</small></div><div class="session-history-result"><strong>${this.formatPercent(session.correct, session.answered)}</strong><small>${session.correct} correct · ${session.incorrect} incorrect · ${session.answered} answered</small></div>`;
        list.appendChild(row);
      }
    },

    returnHome() {
      if (!this.$?.homeCard || !this.$?.mainCard) return;
      this.$.homeCard.style.display = 'block';
      this.$.mainCard.style.display = 'none';
      document.body.classList.add('home-mode');
      document.body.classList.remove('practice-mode');
      this.updateHomeSummary();
      this.updateDashboardAnalyticsUI();
    },

    updateHomeSummary() {
      if (!this.$?.homeModuleSummary || !this.state) return;
      const names = MODULES
        .filter(m => this.isModuleInCurrentLevel(m) && this.isModulePracticeEnabled(m.key))
        .map(m => m.name);
      this.$.homeModuleSummary.textContent = names.length ? names.join(', ') : 'No modules selected yet';
    },

    updateCountsRow() {
      const parts = [];
      for (const m of MODULES) {
        const c = this.getModuleCounts(m.key);
        const on = this.state.settings.modulesEnabled[m.key];
        const label = `${m.name}: ${c.available}/${c.total}`;
        parts.push(on ? label : `<span style="opacity:.45">${label}</span>`);
      }
      this.$.countsRow.innerHTML = parts.join(' &nbsp;•&nbsp; ');
      if (this.currentLevel) this.setLevel(this.currentLevel);
      this.updateHomeSummary();
    },

    updateHiddenCountLabel() {
      const n = Object.keys(this.state.hiddenItems).length;
      this.$.hiddenCountLabel.textContent = n ? `${n} hidden` : '0 hidden';
    },

    // --------------------------------------------
    // Banner helpers
    // --------------------------------------------
    showBanner(html) {
      this.$.bannerText.innerHTML = html;
      this.$.banner.style.display = 'flex';
    },

    hideBanner() {
      this.$.banner.style.display = 'none';
    },

    // --------------------------------------------
    // Rotation / next question
    // --------------------------------------------
    prepareAnswerTarget(q) {
      q.differentTarget = false;
      q.targetAnswerNorm = '';
      if (q.mode !== 'text' || !q.acceptable || q.acceptable.size < 2 || !q.id) return q;
      const variants = Array.from(new Set([
        ...(Array.isArray(q.answerVariants) ? q.answerVariants : []),
        q.expectedDisplay,
        ...Array.from(q.acceptable)
      ].map(value => normalizeLoose(value)).filter(Boolean)));
      if (variants.length < 2) return q;
      q.answerVariants = variants;
      const history = this.state.answerHistory[q.id] || { recent: [], answers: {} };
      const practiced = variants.filter(answer => (history.answers?.[answer]?.correct || 0) > 0);
      const unpracticed = variants.filter(answer => !practiced.includes(answer));
      const last = history.recent?.[history.recent.length - 1];
      const target = last && unpracticed.find(answer => answer !== last)
        || unpracticed[0]
        || variants.find(answer => answer !== last);
      if (target && last && target !== last && practiced.length < variants.length) {
        q.targetAnswerNorm = target;
        q.differentTarget = true;
        q.targetAnswerDisplay = (q.answerVariants || []).find(answer => normalizeLoose(answer) === target) || target;
        q.expectedDisplay = q.targetAnswerDisplay;
      }
      return q;
    },

    recordAnswerVariant(q, answer) {
      if (!q?.id || !q.acceptable || !answer) return;
      const normalized = normalizeLoose(answer);
      if (!q.acceptable.has(normalized)) return;
      const history = this.state.answerHistory[q.id] || { recent: [], answers: {} };
      const entry = history.answers[normalized] || { attempts: 0, correct: 0 };
      entry.attempts += 1;
      entry.correct += 1;
      history.answers[normalized] = entry;
      history.recent = [...(history.recent || []), normalized].slice(-8);
      this.state.answerHistory[q.id] = history;
    },

    setSoloMode(moduleKey) {
      if ((moduleKey === MAYO_MADNESS_KEY || isMayoMadnessKey(moduleKey)) && !this.hasPremiumAccess()) {
        if (this.$.soloSelect) this.$.soloSelect.value = '';
        this.openPremiumAccess();
        return;
      }
      if (!this.isModulePracticeEnabled(moduleKey)) {
        this.showBanner(`Can’t enter practice-only mode: <strong>${moduleKey}</strong> is disabled in Settings.`);
        if (this.$.soloSelect) this.$.soloSelect.value = '';
        return;
      }
      this.soloMode = moduleKey;
      this.state.lastModule = moduleKey;
      persistLastView({ level: this.currentLevel, module: moduleKey });
      this.saveSoon();
      if (this.$.soloSelect) this.$.soloSelect.value = moduleKey;
      const modeName = moduleKey === MAYO_MADNESS_KEY ? 'Mayo Madness' : (MODULES.find(m => m.key===moduleKey)?.name || moduleKey);
      this.showBanner(`Practice-only mode: <strong>${modeName}</strong>. Click “All enabled modules” to return to rotation.`);
      this.nextQuestion({ forceModule: moduleKey, keepFeedback: false });
    },

    clearSoloMode() {
      this.soloMode = null;
      this.state.lastModule = null;
      persistLastView({ level: this.currentLevel, module: null });
      this.saveSoon();
      if (this.$.soloSelect) this.$.soloSelect.value = '';
      this.hideBanner();
      this.nextQuestion({ keepFeedback: false });
    },

    chooseModule(enabled) {
      // Weighted rotation among enabled modules (bias lower-score modules).
      const mix = Math.max(0, Math.min(100, this.state.moduleChoices.practiceMix ?? 50)) / 100;
      const weights = enabled.map((key) => {
        const score = this.getModuleAverageScore(key);
        const weakness = 1 + (5 - score); // 1..6
        const balanced = 1;
        return (weakness * (1 - mix)) + (balanced * mix);
      });
      const sum = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * sum;
      for (let i = 0; i < enabled.length; i++) {
        r -= weights[i];
        if (r <= 0) return enabled[i];
      }
      return enabled[enabled.length - 1];
    },

    getModuleAverageScore(moduleKey) {
      const hidden = this.state.hiddenItems || {};
      const scores = this.state.itemScores || {};
      const ids = [];
      if (moduleKey === 'numbers') return 2.5;
      if (moduleKey === 'vocab') for (const x of this.vocab) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'mayo_madness_1') for (const x of MAYO_MADNESS_LEVEL_1_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'mayo_madness_2') for (const x of MAYO_MADNESS_LEVEL_2_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'rapid_translations_2') for (const x of RAPID_TRANSLATIONS_LEVEL_2_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'rapid_regular_verbs') for (const x of RAPID_REGULAR_VERB_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'rapid_irregular_verbs') for (const x of RAPID_IRREGULAR_VERB_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'mayo_madness_3_rapid_translations') for (const x of MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'commands') for (const x of this.commandPool) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'reflexive') for (const x of this.reflexivePool) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'tenses') for (const x of this.tensesPool) if (!hidden[x.id] && this.isTenseItemAllowed(x)) ids.push(x.id);
      else if (moduleKey === 'days') for (const x of DAYS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'months') for (const x of MONTHS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'seasons') for (const x of SEASONS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'time') for (const x of TIME_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'colors') for (const x of COLORS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'prices') for (const x of PRICES_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'weather') for (const x of WEATHER_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'clothing') for (const x of CLOTHING_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'foods') for (const x of FOODS_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'present_progressive') for (const x of PRESENT_PROGRESSIVE_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'ser_estar') for (const x of SER_ESTAR_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'gustar') for (const x of GUSTAR_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'dates') for (const x of DATES_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'honors_ordinal_numbers') for (const x of ORDINAL_POOL) if (!hidden[x.id]) ids.push(x.id);
      else if (moduleKey === 'honors_test1_review') for (const x of HONORS_PRETERITE_POOL.concat(HONORS_IMPERFECT_POOL, HONORS_TIME_WORDS, HONORS_CHOICE_POOL)) if (!hidden[x.id]) ids.push(x.id);
      if (!ids.length) return 2.5;
      let total = 0;
      for (const id of ids) total += (scores[id] ?? 2);
      return total / ids.length;
    },

    nextQuestion(opts = {}) {
      const { forceModule = null, keepFeedback = false } = opts;

      if (this.currentQuestion && !forceModule && !this.canAdvanceFromCurrentQuestion()) {
        if (this.currentQuestion.module === 'numbers') {
          this.setNumberFeedback('Type the correct Spanish spelling to continue.', 'bad');
          if (this.$.numberAnswerInput && this.$.numberAnswerInput.offsetParent !== null) this.$.numberAnswerInput.focus();
        } else {
          this.setFeedback('Type the correct answer to continue.', 'bad');
        }
        if (this.currentQuestion.mode === 'text' && this.$.answerInput && this.$.answerInput.offsetParent !== null) {
          this.$.answerInput.focus();
        }
        return;
      }

      this.ensureModuleAvailability();

      const enabled = this.getEnabledModules();
      if (!enabled.length) {
        this.renderEmptyState();
        return;
      }

      let moduleKey = forceModule === MAYO_MADNESS_KEY ? this.chooseModule(enabled) : (forceModule || this.chooseModule(enabled));

      // If forced module is disabled/empty, fall back.
      if (!this.isModulePracticeEnabled(moduleKey)) {
        moduleKey = this.chooseModule(enabled);
      }

      // Generate question; if generator fails (empty), disable module and retry.
      let q = null;
      let premiumSkipped = 0;
      for (let tries = 0; tries < 8; tries++) {
        q = this.generateQuestion(moduleKey);
        if (q && !this.isQuestionAvailableWithoutPremium(q)) {
          premiumSkipped++;
          q = null;
          continue;
        }
        if (q) break;

        // auto-disable and try a different module
        this.state.settings.modulesEnabled[moduleKey] = false;
        this.saveSoon();
        this.updateSoloButtonsDisabled();
        this.updateCountsRow();

        const stillEnabled = this.getEnabledModules();
        if (!stillEnabled.length) break;
        moduleKey = this.chooseModule(stillEnabled);
      }

      // A random generator can occasionally return only premium questions in
      // a short run. Keep the free module usable instead of auto-disabling it.
      if (!q && premiumSkipped) {
        for (let tries = 0; tries < 20 && !q; tries++) {
          const candidate = this.generateQuestion(moduleKey);
          if (candidate && this.isQuestionAvailableWithoutPremium(candidate)) q = candidate;
        }
      }

      if (!q) {
        this.renderEmptyState();
        return;
      }

      this.currentQuestion = q;
      this.answered = false;
      this.sessionQuestionRecorded = false;
      this.prepareAnswerTarget(q);

      this.updateActiveModuleChip(q.module);
      this.renderQuestion(q, { keepFeedback });

      // Recency buffer
      this.pushRecent(q.module, q.id);

      this.updateSoloButtonsDisabled();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
    },

    canAdvanceFromCurrentQuestion() {
      const q = this.currentQuestion;
      if (!q) return true;
      if (q.module === 'numbers') return !this.state.settings.numbersRequireTyping || !!this.answered;
      if (q.mode === 'mcq') return true;
      if (q.mode === 'text') return !!this.answered;
      return true;
    },

    pushRecent(moduleKey, id) {
      const buf = this.recentByModule[moduleKey] || [];
      buf.push(id);
      while (buf.length > 6) buf.shift();
      this.recentByModule[moduleKey] = buf;
    },

    generateQuestion(moduleKey) {
      if (moduleKey === 'numbers') return this.generateNumbersQuestion();
      if (moduleKey === 'vocab') return this.generateVocabQuestion();
      if (moduleKey === 'commands') return this.generateCommandQuestion();
      if (moduleKey === 'reflexive') return this.generateReflexiveQuestion();
      if (moduleKey === 'tenses') return this.generateTensesQuestion();
      if (modules[moduleKey] && typeof modules[moduleKey].generateQuestion === 'function') {
        return modules[moduleKey].generateQuestion(this);
      }
      return null;
    },

    // ----- Numbers -----
    generateNumbersQuestion() {
      const hidden = this.state.hiddenItems;
      const { min, max } = this.getNumbersRange();
      const rangeSize = max - min + 1;

      // quick availability check
      if (this.getModuleCounts('numbers').available === 0) return null;

      let n = null;

      if (this.state.settings.numbersSequential) {
        const start = (this.currentNumber != null && this.currentNumber >= min && this.currentNumber <= max)
          ? this.currentNumber + 1
          : min;
        for (let i = 0; i < rangeSize; i++) {
          const candidate = min + ((((start - min) + i) % rangeSize) + rangeSize) % rangeSize;
          if (!hidden[`number-${candidate}`]) {
            n = candidate;
            break;
          }
        }
        if (n != null) {
          this.practiceRequested = false;
          this.numbersStatus = '';
        }
      }

      // If "Need more practice" was requested and order mode is off, generate a similar number next time Numbers appears.
      if (n == null && this.practiceRequested && this.currentNumber != null) {
        for (let i = 0; i < 20; i++) {
          const candidate = generateSimilar(this.currentNumber, min, max);
          if (!hidden[`number-${candidate}`]) {
            n = candidate;
            break;
          }
        }
        if (n != null) {
          this.practiceRequested = false;
          this.numbersStatus = 'Practice: similar number shown — next Numbers question will be random.';
        }
      }

      // Otherwise random, avoiding hidden and immediate repeats.
      if (n == null) {
        for (let i = 0; i < 2000; i++) {
          const candidate = rand(min, max);
          if (hidden[`number-${candidate}`]) continue;
          if (rangeSize > 1 && candidate === this.currentNumber) continue;
          n = candidate;
          break;
        }
        if (n == null) return null;

        // Once we successfully generate a random number, clear the "similar shown" status.
        if (!this.practiceRequested) this.numbersStatus = this.practiceRequested ? this.numbersStatus : '';
      }

      this.currentNumber = n;
      return { module: 'numbers', id: `number-${n}`, number: n };
    },

    revealSpanishNumber() {
      if (!this.currentQuestion || this.currentQuestion.module !== 'numbers') return;
      const n = this.currentQuestion.number;
      this.$.numberSpanish.textContent = numberToSpanish(n);
    },

    submitNumberAnswer() {
      const q = this.currentQuestion;
      if (!q || q.module !== 'numbers') return;
      if (!this.state.settings.numbersRequireTyping) {
        this.revealSpanishNumber();
        return;
      }
      if (this.answered) {
        this.setNumberFeedback('Already answered - press Next to continue.', 'neutral');
        return;
      }

      const user = this.$.numberAnswerInput.value;
      const expected = numberToSpanish(q.number);
      if (!normalizeLoose(user)) {
        this.setNumberFeedback('Type the Spanish spelling first, then Submit.', 'neutral');
        return;
      }

      const correct = buildAcceptableAnswerSet([expected]).has(normalizeLoose(user));
      this.bumpStats(q.id, correct);
      this.adjustItemScore(q.id, correct);
      this.recordSessionAnswer(correct);

      if (correct) {
        const accentNote = this.accentNoteIfNeeded(user, expected);
        this.answered = true;
        this.$.numberSpanish.textContent = expected;
        this.setNumberFeedback(`Correct: <strong>${escapeHtml(expected)}</strong>${accentNote ? `<br><small>${accentNote}</small>` : ''}`, 'good');
      } else {
        this.answered = false;
        this.setNumberFeedback(`Not quite. Try spelling <strong>${q.number}</strong> in Spanish before continuing.`, 'bad');
      }
      this.saveSoon();
    },

    setNumberFeedback(html, tone) {
      this.$.numberFeedback.classList.remove('good','bad','neutral','flash-good','flash-bad');
      this.$.numberFeedback.classList.add(tone || 'neutral');
      this.$.numberFeedback.innerHTML = html;
      if (tone === 'good') this.$.numberFeedback.classList.add('flash-good');
      if (tone === 'bad') this.$.numberFeedback.classList.add('flash-bad');
    },

    markNeedPractice() {
      if (!this.currentQuestion || this.currentQuestion.module !== 'numbers') return;
      if (this.state.settings.numbersSequential) {
        this.practiceRequested = false;
        this.numbersStatus = 'Order mode is on: next Numbers question will continue in order.';
        this.$.practiceIndicator.textContent = this.numbersStatus;
        return;
      }
      this.practiceRequested = true;
      this.numbersStatus = 'Marked for practice: next Numbers question will be similar.';
      this.$.practiceIndicator.textContent = this.numbersStatus;
    },

    // ----- Vocab -----
    generateVocabQuestion() {
      if (this.getModuleCounts('vocab').available === 0) return null;

      const hidden = this.state.hiddenItems;
      const recent = new Set(this.recentByModule.vocab.slice(-3));

      const candidates = this.vocab.filter(v => !hidden[v.id] && !recent.has(v.id));
      const pool = candidates.length ? candidates : this.vocab.filter(v => !hidden[v.id]);

      if (!pool.length) return null;

      const mode = this.state.settings.vocabMode || 'weighted';

      let pick = null;
      if (this.state.settings.prioritizeWeakQuestions) {
        pick = pickByWeakScore(pool, this.state.itemScores, recent);
      } else if (mode === 'uniform') {
        pick = pickRandom(pool);
      } else {
        // Weighted by normalized complexity, with jitter and mild recency penalty.
        // Weight must be > 0.
        const weights = pool.map(v => {
          const base = 0.05 + v.complexityNorm;
          const jitter = 0.85 + Math.random() * 0.30;
          const penalty = recent.has(v.id) ? 0.25 : 1.0;
          const weak = 1 + (5 - (this.state.itemScores[v.id] ?? 2));
          return base * jitter * penalty * weak;
        });

        const sum = weights.reduce((a,b) => a+b, 0);
        let r = Math.random() * sum;
        for (let i = 0; i < pool.length; i++) {
          r -= weights[i];
          if (r <= 0) { pick = pool[i]; break; }
        }
        if (!pick) pick = pool[pool.length - 1];
      }

      return {
        module: 'vocab',
        id: pick.id,
        mode: 'text',
        prompt: `Translate to Spanish: <strong>${escapeHtml(pick.en)}</strong>`,
        expectedDisplay: pick.sp,
        acceptable: pick.acceptable,
        answerVariants: pick.variants || [pick.sp],
        hasAccent: /[áéíóúñüÁÉÍÓÚÑÜ]/.test(pick.sp)
      };
    },

    // ----- Commands -----
    generateCommandQuestion() {
      if (this.getModuleCounts('commands').available === 0) return null;

      const hidden = this.state.hiddenItems;
      const recent = new Set(this.recentByModule.commands.slice(-3));
      const pool = this.commandPool.filter(c => !hidden[c.id] && !recent.has(c.id));
      const fallback = this.commandPool.filter(c => !hidden[c.id]);
      const item = (pool.length || fallback.length) ? pickByWeakScore(pool.length ? pool : fallback, this.state.itemScores, recent) : null;
      if (!item) return null;

      const verb = item.verb;
      const form = item.form; // usted|nosotros
      const pol = item.pol;   // pos|neg
      const baseForm = commandForm(verb, form);

      // Decide question style for this *single stable id*
      const useMCQ = Math.random() < 0.35; // ~35% multiple-choice

      const pronoun = pickRandom(DIRECT_OBJECT_PRONOUNS);

      if (useMCQ) {
        const correct = pol === 'neg' ? `No ${baseForm}.` : `${capitalize(baseForm)}.`;
        const distract1 = pol === 'neg' ? `No ${wrongCommandFlip(verb, form)}.` : `${capitalize(wrongCommandFlip(verb, form))}.`;
        const distract2 = pol === 'neg' ? `No ${wrongIndicative(verb, form)}.` : `${capitalize(wrongIndicative(verb, form))}.`;
        const distract3 = pol === 'neg' ? `No ${wrongPersonCommand(verb, form)}.` : `${capitalize(wrongPersonCommand(verb, form))}.`;

        const options = shuffle([correct, distract1, distract2, distract3]);

        const prompt = pol === 'neg'
          ? `Choose the correct <strong>${form}</strong> <strong>negative</strong> command for <strong>${escapeHtml(verb)}</strong>.`
          : `Choose the correct <strong>${form}</strong> <strong>affirmative</strong> command for <strong>${escapeHtml(verb)}</strong>.`;

        return {
          module: 'commands',
          id: item.id,
          mode: 'mcq',
          prompt,
          options,
          correctIndex: options.indexOf(correct),
          explanation: commandExplanation(verb, form, pol)
        };
      }

      // Open-ended (text) with occasional pronoun placement practice
      const doPronoun = Math.random() < 0.55;

      if (pol === 'neg') {
        if (doPronoun) {
          // pronoun BEFORE the verb
          return {
            module: 'commands',
            id: item.id,
            mode: 'text',
            prompt: `Fill the blank (pronoun in negative commands goes <strong>before</strong> the verb):<br><strong>No ${pronoun} ____.</strong><br><small>Verb: ${escapeHtml(verb)} • form: ${form}</small>`,
            expectedDisplay: baseForm,
            acceptable: buildAcceptableAnswerSet([baseForm]),
            explanation: `Negative commands: <strong>pronoun before</strong> the verb (“No ${pronoun} ${baseForm}”). ${commandExplanation(verb, form, pol)}`
          };
        }
        return {
          module: 'commands',
          id: item.id,
          mode: 'text',
          prompt: `Type the full <strong>${form}</strong> <strong>negative</strong> command for <strong>${escapeHtml(verb)}</strong>.<br><small>Include <em>no</em>.</small>`,
          expectedDisplay: `no ${baseForm}`,
          acceptable: buildAcceptableAnswerSet([`no ${baseForm}`]),
          explanation: commandExplanation(verb, form, pol)
        };
      }

      // affirmative
      if (doPronoun) {
        // pronoun attached to end (we accept without accent adjustments)
        const full = baseForm + pronoun;
        return {
          module: 'commands',
          id: item.id,
          mode: 'text',
          prompt: `Affirmative commands attach the pronoun to the end.<br>Write the <strong>${form}</strong> command for <strong>${escapeHtml(verb)}</strong> with <strong>${pronoun}</strong> attached:<br><strong>_____</strong>`,
          expectedDisplay: full,
          acceptable: buildAcceptableAnswerSet([full]),
          explanation: `Affirmative commands: <strong>attach</strong> the pronoun (“${baseForm} + ${pronoun} → ${full}”).<br><small>Note: Spanish often adds an accent when attaching pronouns (e.g., <em>hágalo</em>). This app accepts answers with or without that accent shift.</small>`
        };
      }

      return {
        module: 'commands',
        id: item.id,
        mode: 'text',
        prompt: `Form the <strong>${form}</strong> <strong>affirmative</strong> command for <strong>${escapeHtml(verb)}</strong>.<br><small>Just the verb form.</small>`,
        expectedDisplay: baseForm,
        acceptable: buildAcceptableAnswerSet([baseForm]),
        explanation: commandExplanation(verb, form, pol)
      };
    },

    // ----- Reflexive -----
    generateReflexiveQuestion() {
      if (this.getModuleCounts('reflexive').available === 0) return null;

      const hidden = this.state.hiddenItems;
      const recent = new Set(this.recentByModule.reflexive.slice(-3));

      const pool = this.reflexivePool.filter(q => !hidden[q.id] && !recent.has(q.id));
      const fallback = this.reflexivePool.filter(q => !hidden[q.id]);
      const item = (pool.length || fallback.length) ? pickByWeakScore(pool.length ? pool : fallback, this.state.itemScores, recent) : null;
      if (!item) return null;

      const verb = item.verb; // e.g., llamarse
      const base = stripDiacritics(verb.toLowerCase()).endsWith('se') ? stripDiacritics(verb.toLowerCase()).slice(0, -2) : stripDiacritics(verb.toLowerCase());
      const baseInf = base; // e.g., llamar
      const p = item.person;
      const pron = REFLEXIVE_PRONOUN[p];
      const conj = conjugate(baseInf, 'present', p);

      const full = `${pron} ${conj}`;
      const acceptable = buildAcceptableAnswerSet([full, conj]); // accept both “se llama” and “llama” per spec.

      return {
        module: 'reflexive',
        id: item.id,
        mode: 'text',
        prompt: `Conjugate <strong>${escapeHtml(verb)}</strong> in the <strong>${escapeHtml(personLabel(p))}</strong> form (present).<br><small>We accept <em>${full}</em> or just <em>${conj}</em>.</small>`,
        expectedDisplay: full,
        acceptable,
        explanation: `Reflexive verbs normally include the reflexive pronoun (${pron}). In casual drills you may see the verb alone; both are accepted here.`
      };
    },

    // ----- Tenses -----
    generateTensesQuestion() {
      if (this.getModuleCounts('tenses').available === 0) return null;

      const hidden = this.state.hiddenItems;
      const enabledTenses = Object.entries(this.state.settings.tensesEnabled).filter(([k,v]) => v).map(([k]) => k);
      if (!enabledTenses.length) return null;

      // Pick a random pool item that matches enabled tenses and isn't hidden.
      const recent = new Set(this.recentByModule.tenses.slice(-3));

      const pool = this.tensesPool.filter(q => this.isTenseItemAllowed(q) && !hidden[q.id] && !recent.has(q.id));
      const fallback = this.tensesPool.filter(q => this.isTenseItemAllowed(q) && !hidden[q.id]);
      const item = (pool.length || fallback.length) ? pickByWeakScore(pool.length ? pool : fallback, this.state.itemScores, recent) : null;
      if (!item) return null;

      const expected = conjugate(item.verb, item.tense, item.person);
      const acceptable = buildAcceptableAnswerSet([expected]);

      return {
        module: 'tenses',
        id: item.id,
        mode: 'text',
        tense: item.tense,
        prompt: `Conjugate <strong>${escapeHtml(item.verb)}</strong> in the <strong>${escapeHtml(personLabel(item.person))}</strong> form — <strong>${escapeHtml(item.tense)}</strong>.`,
        expectedDisplay: expected,
        acceptable,
        explanation: tenseExplanation(item.verb, item.tense, item.person, expected)
      };
    },

    // --------------------------------------------
    // Rendering
    // --------------------------------------------
    updateActiveModuleChip(moduleKey) {
      const moduleName = MODULES.find(m => m.key === moduleKey)?.name || moduleKey;
      this.$.activeModuleLabel.textContent = moduleName;

      const counts = this.getModuleCounts(moduleKey);
      const solo = this.soloMode ? ' • solo' : '';
      this.$.activeModuleMeta.textContent = ` ${counts.available}/${counts.total}${solo}`;
    },

    renderQuestion(q, opts = {}) {
      const { keepFeedback = false } = opts;
      this.revealStage = 0;

      // Never-show button always visible
      this.$.neverBtn.disabled = !q || !q.id;

      if (q.module === 'numbers') {
        this.$.numbersSection.style.display = '';
        this.$.qaSection.style.display = 'none';
        this.updateNumbersRangeText();

        this.$.numberDisplay.textContent = String(q.number);
        this.$.numberSpanish.textContent = '';
        this.$.practiceIndicator.textContent = this.numbersStatus || '';
        const typingOn = !!this.state.settings.numbersRequireTyping;
        this.$.numberTypingBlock.style.display = typingOn ? '' : 'none';
        this.$.submitNumberBtn.style.display = typingOn ? '' : 'none';
        this.$.revealBtn.textContent = typingOn ? 'Show answer' : 'Reveal in Spanish';
        this.setNumberFeedback(typingOn ? 'Type the full Spanish spelling, then press Enter or Submit. Accents are optional for correctness.' : '', 'neutral');
        if (typingOn) {
          this.$.numberAnswerInput.value = '';
          setTimeout(() => this.$.numberAnswerInput.focus(), 0);
        }

        // Button label: if only numbers enabled, it's "Next Number"; otherwise "Next"
        const enabled = this.getEnabledModules();
        const rotationOnlyNumbers = enabled.length === 1 && enabled[0] === 'numbers';
        this.$.nextNumbersBtn.textContent = rotationOnlyNumbers ? 'Next Number' : 'Next';

        // Numbers hint: show range/order/typing behavior reminder
        this.$.numbersHint.style.display = '';
        window.syncAdminQuestionControl?.();

        if (!keepFeedback) {
          // feedback area is in qa section only; no-op here
        }
        return;
      }

      // non-number modules
      this.$.numbersSection.style.display = 'none';
      this.$.qaSection.style.display = '';

      // Title and prompt
      const title = MODULES.find(m => m.key === q.module)?.name || 'Question';
      this.$.qaTitle.textContent = title;
      this.$.qaPrompt.innerHTML = q.prompt || '';
      this.$.practiceIndicator.textContent = q.differentTarget ? 'Different than last time' : '';

      // Reset UI
      this.$.mcqBlock.style.display = 'none';
      this.$.textBlock.style.display = 'none';

      if (!keepFeedback) this.setFeedback('Type your answer, then press Enter or click Submit.', 'neutral');

      if (q.mode === 'mcq') {
        this.$.mcqBlock.style.display = '';
        this.renderMcq(q);
      } else {
        this.$.textBlock.style.display = '';
        this.$.answerInput.value = '';
        setTimeout(() => this.$.answerInput.focus(), 0);
      }
      window.syncAdminQuestionControl?.();
    },

    renderMcq(q) {
      this.$.mcqList.innerHTML = '';
      const groupName = 'mcq_' + Math.random().toString(36).slice(2);

      q.options.forEach((opt, idx) => {
        const id = groupName + '_' + idx;
        const label = document.createElement('label');
        label.className = 'mcq-option';
        label.setAttribute('for', id);

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = groupName;
        input.id = id;
        input.value = String(idx);

        const span = document.createElement('span');
        span.textContent = opt;

        label.appendChild(input);
        label.appendChild(span);
        this.$.mcqList.appendChild(label);
      });

      // Allow Enter to submit when focus inside mcq block
      this.$.mcqList.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this.answered) this.nextQuestion({ keepFeedback: false });
          else this.submitAnswer();
        }
      }, { once: true });

      // Focus first option for keyboard nav
      setTimeout(() => {
        const first = this.$.mcqList.querySelector('input[type="radio"]');
        if (first) first.focus();
      }, 0);
    },

    renderEmptyState() {
      this.$.numbersSection.style.display = 'none';
      this.$.qaSection.style.display = '';
      this.$.qaTitle.textContent = 'No questions available';
      this.$.qaPrompt.textContent = 'Everything enabled appears to be empty (or hidden). Restore hidden questions or enable a module in Settings.';
      this.$.mcqBlock.style.display = 'none';
      this.$.textBlock.style.display = 'none';
      this.setFeedback('Open Settings (⚙) → Manage hidden questions, or enable a module.', 'bad');
    },

    revealHint() {
      const q = this.currentQuestion;
      if (!q) return;
      if (q.module === 'numbers') {
        this.revealSpanishNumber();
        this.revealStage = 1;
        return;
      }
      const expected = q.expectedDisplay || '';
      if (!expected) return;
      const words = expected.split(/\s+/).filter(Boolean);
      const firstWord = words[0] || '';
      let hint = expected.charAt(0) ? `Starts with: <strong>${escapeHtml(expected.charAt(0))}</strong>` : '';
      if (/^(el|la|los|las|un|una)\b/i.test(expected)) {
        hint = `Article cue: <strong>${escapeHtml(firstWord)}</strong>`;
      } else if (words.length > 1) {
        hint = `First words cue: <strong>${escapeHtml(words.slice(0, 2).join(' '))}</strong>`;
      }
      this.setFeedback(`Hint: ${hint}`, 'neutral');
      this.revealStage = 1;
    },

    revealFull() {
      const q = this.currentQuestion;
      if (!q) return;
      if (q.module === 'numbers') {
        this.revealSpanishNumber();
        this.revealStage = 2;
        return;
      }
      if (q.expectedDisplay) this.setFeedback(`Reveal: <strong>${escapeHtml(q.expectedDisplay)}</strong>`, 'neutral');
      this.revealStage = 2;
    },

    handleRevealKey() {
      if (!this.currentQuestion) return;
      if (this.revealStage === 0) this.revealHint();
      else this.handleAdvanceKey();
    },

    handleAdvanceKey() {
      if (!this.currentQuestion) return;
      if (this.currentQuestion.module === 'numbers') {
        this.nextQuestion({ keepFeedback: false });
        return;
      }
      if (this.revealStage < 2) {
        this.revealFull();
        return;
      }
      this.nextQuestion({ keepFeedback: false });
    },

    // --------------------------------------------
    // Answering + feedback
    // --------------------------------------------
    submitAnswer() {
      const q = this.currentQuestion;
      if (!q || q.module === 'numbers') return; // numbers has no typing submission

      if (this.answered) {
        this.setFeedback('Already answered — press Next to continue.', 'neutral');
        return;
      }

      let correct = false;

      if (q.mode === 'mcq') {
        const selected = this.$.mcqList.querySelector('input[type="radio"]:checked');
        if (!selected) {
          this.setFeedback('Pick an option first (arrow keys work), then Submit.', 'neutral');
          return;
        }
        const idx = parseInt(selected.value, 10);
        correct = (idx === q.correctIndex);

        const correctText = q.options[q.correctIndex];

        if (correct) {
          this.setFeedback(`✅ Correct.<br><small>${q.explanation || ''}</small>`, 'good');
        } else {
          this.setFeedback(`❌ Not quite. Correct answer: <strong>${escapeHtml(correctText)}</strong><br><small>${q.explanation || ''}</small>`, 'bad');
        }
      } else {
        const user = this.$.answerInput.value;
        const userNorm = normalizeLoose(user);

        if (!userNorm) {
          this.setFeedback('Type an answer first, then Submit.', 'neutral');
          return;
        }

        if (q.module === 'time' && q.acceptableTime) {
          const parsed = normalizeTimeToCanonical(user);
          correct = !!parsed && q.acceptableTime.has(parsed);
        } else {
          correct = q.acceptable && q.acceptable.has(userNorm);
        }

        const validAnswer = correct && q.acceptable && q.acceptable.has(userNorm);
        const targetMissed = validAnswer && q.targetAnswerNorm && userNorm !== q.targetAnswerNorm;
        if (validAnswer) this.recordAnswerVariant(q, user);

        // Stats
        this.bumpStats(q.id, correct);

        if (correct) {
          const accentNote = this.accentNoteIfNeeded(user, q.expectedDisplay);
          const targetNote = targetMissed ? '<br><small>This was valid. This exercise was practicing a different answer.</small>' : '';
          this.setFeedback(`✅ Correct: <strong>${escapeHtml(user.trim())}</strong>${targetNote}${accentNote ? `<br><small>${accentNote}</small>` : ''}<br><small>${q.explanation || ''}</small>`, 'good');
        } else {
          this.setFeedback(`❌ Not quite. Correct answer: <strong>${escapeHtml(q.expectedDisplay)}</strong><br><small>${q.explanation || ''}</small><br><small>You must type the correct answer before continuing.</small>`, 'bad');
        }
      }

      // Stats for MCQ too
      if (q.mode === 'mcq') this.bumpStats(q.id, correct);
      this.adjustItemScore(q.id, correct);
      this.recordSessionAnswer(correct);

      this.answered = (q.mode === 'mcq') ? true : !!correct;
      this.saveSoon();
    },

    bumpStats(id, correct) {
      if (!id) return;
      const st = this.state.userStats[id] || { attempts: 0, correct: 0 };
      st.attempts = (st.attempts || 0) + 1;
      if (correct) st.correct = (st.correct || 0) + 1;
      this.state.userStats[id] = st;
    },

    adjustItemScore(id, correct) {
      if (!id) return;
      const curr = this.state.itemScores[id] ?? 2;
      this.state.itemScores[id] = correct ? Math.min(5, curr + 1) : Math.max(0, curr - 1);
    },

    accentNoteIfNeeded(userInput, expected) {
      // If expected contains diacritics but user didn't type any, nudge gently.
      const hasExpectedDia = stripDiacritics(expected) !== expected;
      const userHasDia = stripDiacritics(userInput) !== userInput;
      if (hasExpectedDia && !userHasDia) {
        return `Spelling note: <em>${escapeHtml(expected)}</em> uses an accent/diacritic. (Accents are optional for correctness here.)`;
      }
      return '';
    },

    setFeedback(html, tone /* good|bad|neutral */) {
      this.$.feedback.classList.remove('good','bad','neutral','flash-good','flash-bad');
      this.$.feedback.classList.add(tone || 'neutral');
      this.$.feedback.innerHTML = html;
      if (tone === 'good') this.$.feedback.classList.add('flash-good');
      if (tone === 'bad') this.$.feedback.classList.add('flash-bad');
    },

    // --------------------------------------------
    // Hiding questions
    // --------------------------------------------
    hideCurrentQuestion() {
      const q = this.currentQuestion;
      if (!q || !q.id) return;

      this.state.hiddenItems[q.id] = true;
      this.saveSoon();
      this.updateCountsRow();
      this.updateHiddenCountLabel();

      this.showBanner(`Hidden: <strong>${escapeHtml(this.describeId(q.id))}</strong><br><small>You can restore it in “Manage hidden questions”.</small>`);

      // If we hid the current number, also clear its reveal text.
      if (q.module === 'numbers') {
        this.$.numberSpanish.textContent = '';
      }

      // Move on immediately
      this.answered = true;
      this.nextQuestion({ forceModule: this.soloMode || null, keepFeedback: false });
    },

    describeId(id) {
      if (id.startsWith('number-')) {
        return `Number ${id.replace('number-','')}`;
      }
      if (id.startsWith('vocab-')) {
        const v = this.vocabById.get(id);
        if (v) return `Honors Vocab: "${v.en}" → ${v.sp}`;
        return id;
      }
      if (id.startsWith('mayo1-')) {
        const v = MAYO_MADNESS_LEVEL_1_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 1 Vocab: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('mayo2-')) {
        const v = MAYO_MADNESS_LEVEL_2_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 2 Vocab: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('rapid2-')) {
        const v = RAPID_TRANSLATIONS_LEVEL_2_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 2 Rapid Fire Translations: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('rapid-reg-')) {
        const v = RAPID_REGULAR_VERB_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 2 Rapid Fire Regular Verb Conjugations: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('rapid-irreg-')) {
        const v = RAPID_IRREGULAR_VERB_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 2 Rapid Fire Irregular Verb Conjugations: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('mayo3-')) {
        const v = MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL.find((item) => item.id === id);
        if (v) return `Mayo Madness Level 3 Rapid Fire Translations: "${v.en}" -> ${v.sp}`;
        return id;
      }
      if (id.startsWith('cmd-')) {
        const parts = id.split('-');
        const form = parts[parts.length - 2];
        const pol = parts[parts.length - 1];
        const verb = parts.slice(1, parts.length - 2).join('-');
        return `Command: ${verb} • ${form} • ${pol}`;
      }
      if (id.startsWith('conj-')) {
        const parts = id.split('-');
        const person = parts[parts.length - 1];
        const tense = parts[parts.length - 2];
        const verb = parts.slice(1, parts.length - 2).join('-');
        return `Conjugation: ${verb} • ${tense} • ${person}`;
      }
      if (id.startsWith('days-') || id.startsWith('months-') || id.startsWith('seasons-') || id.startsWith('time-') || id.startsWith('colors-') || id.startsWith('price-') || id.startsWith('weather-') || id.startsWith('clothing-') || id.startsWith('foods-') || id.startsWith('prog-') || id.startsWith('serestar-') || id.startsWith('gustar-') || id.startsWith('seg-') || id.startsWith('date-')) {
        return `Module item: ${id}`;
      }
      return id;
    },

    rebuildHiddenList() {
      const hiddenIds = Object.keys(this.state.hiddenItems);
      hiddenIds.sort();

      this.$.hiddenList.innerHTML = '';
      this.$.hiddenEmptyNote.style.display = hiddenIds.length ? 'none' : '';

      this.$.hiddenSummary.textContent = hiddenIds.length
        ? `${hiddenIds.length} hidden question(s).`
        : 'Nothing is hidden.';

      for (const id of hiddenIds) {
        const row = document.createElement('div');
        row.className = 'hidden-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.id = id;
        cb.ariaLabel = 'Select hidden item';

        const label = document.createElement('label');
        label.style.flex = '1';

        const desc = document.createElement('div');
        desc.textContent = this.describeId(id);

        const code = document.createElement('code');
        code.textContent = id;

        label.appendChild(desc);
        label.appendChild(code);

        row.appendChild(cb);
        row.appendChild(label);

        this.$.hiddenList.appendChild(row);
      }
    },

    restoreSelectedHidden() {
      const checks = Array.from(this.$.hiddenList.querySelectorAll('input[type="checkbox"]:checked'));
      if (!checks.length) {
        this.showBanner('Select at least one hidden item to restore.');
        return;
      }
      for (const cb of checks) {
        const id = cb.dataset.id;
        delete this.state.hiddenItems[id];
      }
      this.saveSoon();
      this.ensureModuleAvailability();
      this.rebuildHiddenList();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
      this.showBanner(`Restored ${checks.length} item(s).`);
    },

    restoreAllHidden() {
      const n = Object.keys(this.state.hiddenItems).length;
      this.state.hiddenItems = {};
      this.saveSoon();
      this.ensureModuleAvailability();
      this.rebuildHiddenList();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
      this.showBanner(n ? `Restored all hidden items (${n}).` : 'Nothing to restore.');
    },

    exportHidden() {
      this.debounceButton(this.$.exportHiddenBtn);

      const payload = {
        version: APP_VERSION,
        hiddenItems: this.state.hiddenItems
      };
      downloadJson('spanishPractice_hiddenQuestions.json', payload);
      this.showBanner('Exported hidden list as JSON.');
    },

    importHiddenFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      e.target.value = '';

      const replace = !!this.$.importHiddenReplace.checked;

      file.text().then((txt) => {
        let parsed;
        try {
          parsed = JSON.parse(txt);
        } catch {
          this.showBanner('That file is not valid JSON.');
          return;
        }

        let hidden = null;
        if (isPlainObject(parsed) && isPlainObject(parsed.hiddenItems)) hidden = parsed.hiddenItems;
        else if (isPlainObject(parsed) && isPlainObject(parsed.hiddenQuestions)) hidden = parsed.hiddenQuestions;
        else if (isPlainObject(parsed)) hidden = parsed; // allow raw map

        if (!isPlainObject(hidden)) {
          this.showBanner('Hidden import must be an object of { "question-id": true, ... }.');
          return;
        }

        const nextHidden = replace ? {} : { ...this.state.hiddenItems };
        for (const [k, v] of Object.entries(hidden)) {
          if (typeof k === 'string' && v) nextHidden[k] = true;
        }

        this.state.hiddenItems = nextHidden;
        this.saveSoon();
        this.ensureModuleAvailability();
        this.rebuildHiddenList();
        this.updateCountsRow();
        this.updateHiddenCountLabel();
        this.showBanner(`Imported hidden list (${Object.keys(hidden).length} entries).`);
      });
    },

    // --------------------------------------------
    // Export / Import / Reset (full state)
    // --------------------------------------------
    exportAll() {
      this.debounceButton(this.$.exportAllBtn);

      const payload = {
        version: APP_VERSION,
        settings: this.state.settings,
        hiddenItems: this.state.hiddenItems,
        itemScores: this.state.itemScores,
        moduleChoices: this.state.moduleChoices,
        vocabChecksum: this.state.vocabChecksum,
        userStats: this.state.userStats
      };
      downloadJson('spanishPracticeApp_userData_v2.json', payload);
      this.showBanner('Exported user data as JSON.');
    },

    importAllFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      e.target.value = '';

      file.text().then((txt) => {
        let parsed;
        try {
          parsed = JSON.parse(txt);
        } catch {
          this.showBanner('That file is not valid JSON.');
          return;
        }

        const next = sanitizeState(parsed);

        this.state = next;
        saveState(this.state);

        this.refreshSettingsUI();
        this.ensureModuleAvailability();
        this.updateCountsRow();
        this.updateHiddenCountLabel();

        this.state.hiddenItems = this.state.hiddenItems || {};
        this.state.hiddenQuestions = this.state.hiddenItems;
        this.state.itemScores = this.state.itemScores || {};
      this.state.moduleChoices = this.state.moduleChoices || { practiceMix: 50, showKeyHintStrip: false, newModulesAnswerMode: 'spelling' };
        this.showBanner('Imported user data.');
        this.nextQuestion({ keepFeedback: false });
      });
    },

    resetAll() {
      this.debounceButton(this.$.resetBtn);

      const ok = window.confirm('Reset will clear this app’s saved data (settings, hidden items, scores, stats). Continue?');
      if (!ok) return;
      this.undoResetSnapshot = JSON.parse(JSON.stringify(this.state));
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (err) {
        if (window.APP_DEBUG) console.warn('Storage clear issue:', err);
      }
      this.state = defaultState();
      this.state.hiddenQuestions = this.state.hiddenItems;
      saveState(this.state);

      this.practiceRequested = false;
      this.currentNumber = null;
      this.numbersStatus = '';

      this.refreshSettingsUI();
      this.ensureModuleAvailability();
      this.updateCountsRow();
      this.updateHiddenCountLabel();

      this.showBanner('Reset complete. Back to defaults.');
      this.showUndoToast();
      this.nextQuestion({ forceModule: 'numbers', keepFeedback: false });
    },

    showUndoToast() {
      clearTimeout(this.undoTimer);
      this.$.undoToastText.textContent = 'Progress reset. Undo available for 5 seconds.';
      this.$.undoToast.style.display = 'flex';
      this.undoTimer = setTimeout(() => {
        this.$.undoToast.style.display = 'none';
        this.undoResetSnapshot = null;
      }, 5000);
    },

    undoReset() {
      if (!this.undoResetSnapshot) return;
      clearTimeout(this.undoTimer);
      this.state = sanitizeState(this.undoResetSnapshot);
      this.state.hiddenQuestions = this.state.hiddenItems;
      saveState(this.state);
      this.$.undoToast.style.display = 'none';
      this.refreshSettingsUI();
      this.ensureModuleAvailability();
      this.updateCountsRow();
      this.updateHiddenCountLabel();
      this.renderKeyHintStrip();
      this.showBanner('Reset undone. Previous progress restored.');
      this.nextQuestion({ keepFeedback: false });
      this.undoResetSnapshot = null;
    },

    debounceButton(btn) {
      btn.disabled = true;
      setTimeout(() => { btn.disabled = false; }, 650);
    },

    // --------------------------------------------
    // Accent insertion
    // --------------------------------------------
    insertAccent(char) {
      const input = this.$.answerInput;
      if (!input || input.offsetParent === null) return; // hidden
      input.focus();

      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;

      const before = input.value.slice(0, start);
      const after = input.value.slice(end);

      input.value = before + char + after;

      const pos = start + char.length;
      input.setSelectionRange(pos, pos);
    },

    // --------------------------------------------
    // Persistence (debounced)
    // --------------------------------------------
    saveSoon() {
      clearTimeout(this.saveTimer);
      this.state.hiddenQuestions = this.state.hiddenItems;
      this.saveTimer = setTimeout(() => saveState(this.state), 450);
    },

    runAutomatedChecks(opts = {}) {
      const { startup = false } = opts;
      const results = [];
      const requiredModules = ['days', 'months', 'seasons', 'time', 'colors', 'mayo_madness_1', 'mayo_madness_2', 'rapid_translations_2', 'rapid_regular_verbs', 'rapid_irregular_verbs', 'mayo_madness_3_rapid_translations', 'prices', 'weather', 'clothing', 'foods', 'present_progressive', 'ser_estar', 'gustar', 'dates', 'honors_ordinal_numbers', 'honors_test1_review'];
      const hasModules = requiredModules.every((key) => MODULES.some((m) => m.key === key) && modules[key]);
      results.push({ ok: hasModules, label: 'Expanded modules registered (including Mayo Madness parent submodules)' });
      results.push({ ok: MODULES.find((m) => m.key === 'honors_ordinal_numbers')?.level === 2 && MODULES.find((m) => m.key === 'honors_test1_review')?.level === 2, label: 'Spanish 2 Honors modules are level 2 only' });
      results.push({ ok: !PREMIUM_COMPLEX_MODULES.has('honors_ordinal_numbers') && !PREMIUM_COMPLEX_MODULES.has('honors_test1_review'), label: 'Spanish 2 Honors modules are not premium-locked' });
      const ordinalAnswers = buildAcceptableAnswerSet(['tercera']);
      results.push({ ok: ordinalAnswers.has(normalizeLoose('TERCERA')) && buildAcceptableAnswerSet(['tercer']).has(normalizeLoose('tercer')) && !buildAcceptableAnswerSet(['tercera']).has(normalizeLoose('tercero')), label: 'Ordinal gender agreement and contextual tercero/tercer forms are strict' });
      results.push({ ok: honorsRegularConjugate('hablar', 'preterite', '1s') === 'hablé' && honorsRegularConjugate('comer', 'imperfect', '1p') === 'comíamos' && honorsRegularConjugate('vivir', 'imperfect', '2p') === 'vivíais', label: 'Honors regular preterite/imperfect endings cover all six persons' });
      results.push({ ok: buildAcceptableAnswerSet(['suddenly', 'all of a sudden']).has(normalizeLoose('all of a sudden')) && buildAcceptableAnswerSet(['normally', 'generally']).has(normalizeLoose('generally')), label: 'Honors vocabulary accepts natural English synonyms' });
      const priorPremiumForChecks = this.mayoPremiumUnlocked;
      this.mayoPremiumUnlocked = false;
      const freeOrdinal = modules.honors_ordinal_numbers.generateQuestion(this);
      this.mayoPremiumUnlocked = true;
      const premiumOrdinal = modules.honors_ordinal_numbers.generateQuestion(this);
      this.mayoPremiumUnlocked = priorPremiumForChecks;
      results.push({ ok: !!freeOrdinal && !!premiumOrdinal && ORDINAL_POOL.length > 12, label: 'Honors ordinal free/premium pools differ in depth' });
      const priorCheckLevel = this.currentLevel;
      const priorCheckSolo = this.soloMode;
      const priorOrdinalOn = this.state.settings.modulesEnabled.honors_ordinal_numbers;
      const priorTestOn = this.state.settings.modulesEnabled.honors_test1_review;
      const priorPremiumTarget = this.mayoPremiumUnlocked;
      this.currentLevel = 'spanish2';
      this.soloMode = 'honors_ordinal_numbers';
      this.state.settings.modulesEnabled.honors_ordinal_numbers = true;
      this.state.settings.modulesEnabled.honors_test1_review = false;
      this.mayoPremiumUnlocked = false;
      const freeOrdinalTarget = this.getSessionTarget();
      this.mayoPremiumUnlocked = true;
      const premiumOrdinalTarget = this.getSessionTarget();
      this.soloMode = 'honors_test1_review';
      this.state.settings.modulesEnabled.honors_test1_review = true;
      const premiumTestTarget = this.getSessionTarget();
      this.mayoPremiumUnlocked = false;
      const freeTestTarget = this.getSessionTarget();
      this.currentLevel = priorCheckLevel;
      this.soloMode = priorCheckSolo;
      this.state.settings.modulesEnabled.honors_ordinal_numbers = priorOrdinalOn;
      this.state.settings.modulesEnabled.honors_test1_review = priorTestOn;
      this.mayoPremiumUnlocked = priorPremiumTarget;
      results.push({ ok: freeOrdinalTarget === 8 && premiumOrdinalTarget === 14 && freeTestTarget === 16 && premiumTestTarget === 24, label: 'Honors free/premium session targets differ as intended' });
      results.push({ ok: MAYO_MADNESS_SUBMODULE_KEYS.length === 6 && MAYO_MADNESS_SUBMODULE_KEYS.every((key) => requiredModules.includes(key)), label: 'Mayo Madness parent tracks all submodules' });
      results.push({ ok: !MODULES.some((m) => m.key === 'ser_estar_gustar'), label: 'Deprecated ser_estar_gustar module removed from registry' });
      results.push({ ok: DAYS_POOL.length >= 7, label: 'Days pool has >= 7 items' });
      results.push({ ok: MONTHS_POOL.length >= 12, label: 'Months pool has >= 12 items' });
      results.push({ ok: SEASONS_POOL.length >= 4, label: 'Seasons pool has >= 4 items' });
      results.push({ ok: TIME_POOL.length >= 30, label: 'Time pool has >= 30 items' });
      results.push({ ok: COLORS_POOL.length >= 15, label: 'Colors pool has >= 15 items' });
      results.push({ ok: MAYO_MADNESS_LEVEL_1_POOL.length === 9, label: 'Mayo Madness Level 1 Vocab pool has 9 items' });
      results.push({ ok: MAYO_MADNESS_LEVEL_2_POOL.length === 7, label: 'Mayo Madness Level 2 Vocab pool has 7 items' });
      results.push({ ok: RAPID_TRANSLATIONS_LEVEL_2_POOL.length === 5, label: 'Mayo Madness Level 2 Rapid Fire Translations pool has 5 items' });
      results.push({ ok: RAPID_REGULAR_VERB_POOL.length === 8, label: 'Mayo Madness Level 2 Rapid Fire Regular Verb Conjugations pool has 8 items' });
      results.push({ ok: RAPID_IRREGULAR_VERB_POOL.length === 9, label: 'Mayo Madness Level 2 Rapid Fire Irregular Verb Conjugations pool has 9 items' });
      results.push({ ok: MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL.length === 13, label: 'Mayo Madness Level 3 Rapid Fire Translations pool has 13 items' });
      results.push({ ok: PRICES_POOL.length >= 30, label: 'Prices pool has >= 30 items' });
      results.push({ ok: WEATHER_POOL.length >= 20, label: 'Weather pool has >= 20 items' });
      results.push({ ok: CLOTHING_POOL.length >= 20, label: 'Clothing pool has >= 20 items' });
      results.push({ ok: FOODS_POOL.length >= 20, label: 'Foods pool has >= 20 items' });
      results.push({ ok: PRESENT_PROGRESSIVE_POOL.length >= 16, label: 'Present Progressive pool has >= 16 items' });
      results.push({ ok: DATES_POOL.length >= 20, label: 'Dates pool has >= 20 items' });
      results.push({ ok: SER_ESTAR_POOL.length >= 20, label: 'Ser/Estar pool has >= 20 items' });
      results.push({ ok: GUSTAR_POOL.length >= 16, label: 'Gustar pool has >= 16 items' });
      results.push({ ok: this.vocab.length > 0, label: 'Vocab parsed entries > 0 after overlap filtering' });
      results.push({ ok: !this.vocab.some((v) => normalizeLoose(v.sp) === 'el lunes'), label: 'Vocab overlap exclusion removes dedicated-module entries (example: el lunes)' });
      results.push({ ok: this.vocab.some((v) => normalizeLoose(v.sp) === 'la pared'), label: 'Vocab keeps non-overlap entries (example: la pared)' });
      const vocabSample = this.vocab.find((v) => !this.state.hiddenItems[v.id]);
      results.push({ ok: !vocabSample || this.generateVocabQuestion()?.mode === 'text', label: 'Vocab generator returns text mode' });
      const mayoSample = modules.mayo_madness_1.generateQuestion(this);
      results.push({ ok: !!mayoSample && mayoSample.mode === 'text' && mayoSample.acceptable instanceof Set, label: 'Mayo Madness Level 1 Vocab generates text questions' });
      const deskItem = MAYO_MADNESS_LEVEL_1_POOL.find((x) => x.id === 'mayo1-escritorio');
      const deskAnswers = buildAcceptableAnswerSet(deskItem.acceptable || [deskItem.sp]);
      results.push({ ok: deskAnswers.has(normalizeLoose('pupitre')), label: 'Mayo Madness Level 1 desk accepts pupitre' });
      const mayo2Sample = modules.mayo_madness_2.generateQuestion(this);
      results.push({ ok: !!mayo2Sample && mayo2Sample.mode === 'text' && mayo2Sample.acceptable instanceof Set, label: 'Mayo Madness Level 2 Vocab generates text questions' });
      const rapidTranslationSample = modules.rapid_translations_2.generateQuestion(this);
      const rapidRegularSample = modules.rapid_regular_verbs.generateQuestion(this);
      const rapidIrregularSample = modules.rapid_irregular_verbs.generateQuestion(this);
      const mayo3Sample = modules.mayo_madness_3_rapid_translations.generateQuestion(this);
      results.push({ ok: !!rapidTranslationSample && rapidTranslationSample.mode === 'text' && rapidTranslationSample.acceptable instanceof Set, label: 'Mayo Madness Level 2 Rapid Fire Translations generates text questions' });
      results.push({ ok: !!rapidRegularSample && rapidRegularSample.mode === 'text' && rapidRegularSample.acceptable instanceof Set, label: 'Mayo Madness Level 2 Rapid Fire Regular Verb Conjugations generates text questions' });
      results.push({ ok: !!rapidIrregularSample && rapidIrregularSample.mode === 'text' && rapidIrregularSample.acceptable instanceof Set, label: 'Mayo Madness Level 2 Rapid Fire Irregular Verb Conjugations generates text questions' });
      results.push({ ok: !!mayo3Sample && mayo3Sample.mode === 'text' && mayo3Sample.acceptable instanceof Set, label: 'Mayo Madness Level 3 Rapid Fire Translations generates text questions' });
      const knowAnswers = buildAcceptableAnswerSet(RAPID_IRREGULAR_VERB_POOL.find((x) => x.id === 'rapid-irreg-know').acceptable);
      results.push({ ok: knowAnswers.has(normalizeLoose('yo se')) && knowAnswers.has(normalizeLoose('yo conozco')), label: 'Rapid Fire irregular I know accepts yo se/yo conozco variants' });
      const watchAnswers = buildAcceptableAnswerSet(RAPID_REGULAR_VERB_POOL.find((x) => x.id === 'rapid-reg-watch').acceptable);
      results.push({ ok: watchAnswers.has(normalizeLoose('miramos')) && watchAnswers.has(normalizeLoose('vemos')), label: 'Rapid Fire regular We watch accepts miramos and vemos' });
      const sisterAnswers = buildAcceptableAnswerSet(RAPID_TRANSLATIONS_LEVEL_2_POOL.find((x) => x.id === 'rapid2-sisters').acceptable);
      results.push({ ok: sisterAnswers.has(normalizeLoose('yo tengo 5 hermanas altas con ojos azules')), label: 'Rapid Fire sentence variants accept optional subject and digit forms' });
      const hurryAnswers = buildAcceptableAnswerSet(MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL.find((x) => x.id === 'mayo3-hurry-hungry').acceptable);
      results.push({ ok: hurryAnswers.has(normalizeLoose('nosotras estamos con prisa y tenemos hambre')), label: 'Mayo Madness Level 3 accepts subject and regional sentence variants' });
      const knewAnswers = buildAcceptableAnswerSet(MAYO_MADNESS_LEVEL_3_RAPID_TRANSLATIONS_POOL.find((x) => x.id === 'mayo3-i-knew').acceptable);
      results.push({ ok: knewAnswers.has(normalizeLoose('yo supe')) && knewAnswers.has(normalizeLoose('yo sabia')), label: 'Mayo Madness Level 3 accepts past-tense variation pairs' });
      const priorPremiumUnlocked = this.mayoPremiumUnlocked;
      const priorParentEnabled = this.state.settings.mayoMadnessEnabled;
      const priorLevel1Enabled = this.state.settings.modulesEnabled.mayo_madness_1;
      const priorMayoHidden = this.state.hiddenItems['mayo1-lapiz'];
      delete this.state.hiddenItems['mayo1-lapiz'];
      this.state.settings.mayoMadnessEnabled = true;
      this.state.settings.modulesEnabled.mayo_madness_1 = true;
      this.mayoPremiumUnlocked = false;
      const lockedBlocksMayo = !this.isModulePracticeEnabled('mayo_madness_1') && this.getEnabledMayoMadnessModules().length === 0;
      this.mayoPremiumUnlocked = true;
      const unlockedAllowsMayo = this.isModulePracticeEnabled('mayo_madness_1') && this.getEnabledMayoMadnessModules().includes('mayo_madness_1');
      this.mayoPremiumUnlocked = priorPremiumUnlocked;
      this.state.settings.mayoMadnessEnabled = priorParentEnabled;
      this.state.settings.modulesEnabled.mayo_madness_1 = priorLevel1Enabled;
      if (priorMayoHidden) this.state.hiddenItems['mayo1-lapiz'] = priorMayoHidden;
      else delete this.state.hiddenItems['mayo1-lapiz'];
      results.push({ ok: lockedBlocksMayo && unlockedAllowsMayo, label: 'Premium gate blocks Mayo Madness until unlock' });
      results.push({ ok: this.$.premiumPasswordInput?.type === 'password', label: 'Premium password input hides typed characters' });
      const priorNumbersMin = this.state.settings.numbersMin;
      const priorNumbersMax = this.state.settings.numbersMax;
      const priorNumbersSequential = this.state.settings.numbersSequential;
      const priorCurrentNumber = this.currentNumber;
      const priorHiddenItems = { ...this.state.hiddenItems };
      for (let n = 8; n <= 12; n++) delete this.state.hiddenItems[`number-${n}`];
      this.state.settings.numbersMin = 8;
      this.state.settings.numbersMax = 12;
      this.state.settings.numbersSequential = false;
      const rangedNumber = this.generateNumbersQuestion();
      results.push({ ok: !!rangedNumber && rangedNumber.number >= 8 && rangedNumber.number <= 12, label: 'Numbers range setting limits generated questions' });
      this.state.settings.numbersSequential = true;
      this.currentNumber = 10;
      const orderedNumber = this.generateNumbersQuestion();
      results.push({ ok: !!orderedNumber && orderedNumber.number === 11, label: 'Numbers order mode advances sequentially' });
      this.state.settings.numbersMin = priorNumbersMin;
      this.state.settings.numbersMax = priorNumbersMax;
      this.state.settings.numbersSequential = priorNumbersSequential;
      this.currentNumber = priorCurrentNumber;
      this.state.hiddenItems = priorHiddenItems;
      this.state.hiddenQuestions = this.state.hiddenItems;
      results.push({ ok: typeof this.handleRevealKey === 'function' && typeof this.handleAdvanceKey === 'function', label: 'Keyboard shortcuts registered' });
      const visibleHelpText = [
        this.$.numbersKeysHint?.textContent || '',
        this.$.numbersHint?.textContent || '',
        document.querySelector('#firstRunOverlay ul')?.textContent || '',
        document.querySelector('#numbersGuideOverlay ul')?.textContent || '',
        document.querySelector('details.settings-accordion .accordion-inner')?.textContent || ''
      ].join(' ');
      results.push({ ok: /range/i.test(visibleHelpText) && /order mode|go in order/i.test(visibleHelpText) && /typed Numbers|type and spell/i.test(visibleHelpText), label: 'Visible help text covers Numbers range, typed mode, and order mode' });
      results.push({ ok: /Mayo Madness Level 1\/2|Mayo Madness Level 2/i.test(visibleHelpText), label: 'Visible help text covers Mayo Madness Level 1/2 modules' });
      results.push({ ok: /Rapid Fire/i.test(visibleHelpText), label: 'Visible help text covers Rapid Fire modules' });
      results.push({ ok: this.$.countsRow?.closest('.top-row')?.getAttribute('aria-hidden') === 'true', label: 'Main counts/data row stays hidden while counts logic remains available' });
      const missingToggles = MODULES
        .map((m) => m.key)
        .filter((k) => !this.$['toggle_' + k]);
      results.push({ ok: missingToggles.length === 0, label: `Module toggle wiring (${missingToggles.length ? 'missing: ' + missingToggles.join(', ') : 'all present'})` });
      const modeValid = this.state.moduleChoices.newModulesAnswerMode === 'spelling' || this.state.moduleChoices.newModulesAnswerMode === 'mixed';
      results.push({ ok: modeValid, label: 'newModulesAnswerMode setting is valid' });
      const prevMode = this.state.moduleChoices.newModulesAnswerMode;
      this.state.moduleChoices.newModulesAnswerMode = 'spelling';
      const sampleChecks = ['days', 'months', 'seasons', 'time', 'colors'].map((k) => {
        const q = modules[k].generateQuestion(this);
        return !!q && q.mode === 'text';
      });
      this.state.moduleChoices.newModulesAnswerMode = prevMode;
      results.push({ ok: sampleChecks.every(Boolean), label: 'New modules generate text mode in spelling-only setting' });
      const textOnlyChecks = ['mayo_madness_1', 'mayo_madness_2', 'rapid_translations_2', 'rapid_regular_verbs', 'rapid_irregular_verbs', 'mayo_madness_3_rapid_translations', 'prices', 'weather', 'clothing', 'foods', 'present_progressive', 'ser_estar', 'gustar', 'dates'].map((k) => {
        const q = modules[k].generateQuestion(this);
        return !!q && q.mode === 'text';
      });
      results.push({ ok: textOnlyChecks.every(Boolean), label: 'Newly added modules generate text mode' });
      const twelveFifteen = TIME_POOL.find((x) => x.id === 'time-1215');
      results.push({ ok: twelveFifteen && normalizeLoose(twelveFifteen.display).includes('doce') && !normalizeLoose(twelveFifteen.display).includes('una'), label: 'Translation audit: 12:15 uses doce, not una' });
      const janFirstAnswers = buildAcceptableAnswerSet(['el primero de enero', 'el uno de enero']);
      results.push({ ok: janFirstAnswers.has(normalizeLoose('el primero de enero')) && janFirstAnswers.has(normalizeLoose('el uno de enero')), label: 'Translation audit: first-of-month date accepts primero and uno' });
      const rainyAnswers = buildAcceptableAnswerSet(WEATHER_POOL.find((x) => x.id === 'weather-rainy').acceptable);
      results.push({ ok: rainyAnswers.has(normalizeLoose('llueve')), label: 'Translation audit: rainy/weather variants include llueve' });
      const pork = FOODS_POOL.find((x) => x.id === 'foods-pork');
      results.push({ ok: pork && normalizeLoose(pork.sp) === 'la carne de cerdo' && buildAcceptableAnswerSet(pork.acceptable).has(normalizeLoose('el cerdo')), label: 'Translation audit: pork uses food phrase and accepts common shortcut' });
      const serEstarSample = modules.ser_estar.generateQuestion(this);
      const serEstarConjugated = !!serEstarSample && serEstarSample.expectedDisplay && !['ser','estar'].includes(normalizeLoose(serEstarSample.expectedDisplay));
      results.push({ ok: serEstarConjugated, label: 'Ser/Estar expects conjugated form (not infinitive)' });
      results.push({ ok: typeof this.canAdvanceFromCurrentQuestion === 'function', label: 'Strict text retry guard helper exists' });
      const priorQuestion = this.currentQuestion;
      const priorAnswered = this.answered;
      const priorNumbersRequireTyping = this.state.settings.numbersRequireTyping;
      this.currentQuestion = { module: 'vocab', mode: 'text', id: 'smoke-text' };
      this.answered = false;
      const blockTextAdvance = this.canAdvanceFromCurrentQuestion() === false;
      this.currentQuestion = { module: 'commands', mode: 'mcq', id: 'smoke-mcq' };
      this.answered = false;
      const allowMcqAdvance = this.canAdvanceFromCurrentQuestion() === true;
      this.state.settings.numbersRequireTyping = false;
      this.currentQuestion = { module: 'numbers', mode: 'numbers', id: 'smoke-num' };
      this.answered = false;
      const allowNumbersAdvance = this.canAdvanceFromCurrentQuestion() === true;
      this.state.settings.numbersRequireTyping = priorNumbersRequireTyping;
      this.currentQuestion = priorQuestion;
      this.answered = priorAnswered;
      results.push({ ok: blockTextAdvance && allowMcqAdvance && allowNumbersAdvance, label: 'Strict retry applies to text only (MCQ/Numbers unaffected)' });

      const pass = results.filter((r) => r.ok).length;
      const lines = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}: ${r.label}`);
      if (window.APP_DEBUG || !startup) {
        console.group('Claro automated checks');
        for (const line of lines) console.log(line);
        console.log(`Summary: ${pass}/${results.length} passed`);
        console.groupEnd();
      }
      if (this.$.checksOutput) {
        this.$.checksOutput.className = `feedback ${pass === results.length ? 'good' : 'bad'}`;
        this.$.checksOutput.innerHTML = `${lines.join('<br>')}<br><small>Summary: ${pass}/${results.length} passed</small>`;
      }
      return { pass, total: results.length, results };
    }
  };

  // --------------------------------------------
  // Misc helpers for command module
  // --------------------------------------------
  function wrongCommandFlip(verb, form) {
    // Wrong "non-flipped" vowel: -ar uses -a, -er/-ir uses -e (typical mistake)
    const v = stripDiacritics(verb.toLowerCase());
    const type = verbType(v) || 'ar';
    let stem = v.slice(0, -2);
    if (form === 'usted') return stem + (type === 'ar' ? 'a' : 'e');
    return stem + (type === 'ar' ? 'amos' : 'emos');
  }

  function wrongIndicative(verb, form) {
    // Present indicative-ish (another common mistake)
    const v = stripDiacritics(verb.toLowerCase());
    const type = verbType(v) || 'ar';
    const stem = v.slice(0, -2);
    if (form === 'usted') {
      // 3s indicative: habla/come/vive
      const end = (type === 'ar') ? 'a' : 'e';
      return stem + end;
    }
    // nosotros indicative
    const end = (type === 'ar') ? 'amos' : (type === 'er' ? 'emos' : 'imos');
    return stem + end;
  }

  function wrongPersonCommand(verb, form) {
    // Use tú command (informal) as distractor (speak!)
    const v = stripDiacritics(verb.toLowerCase());
    const type = verbType(v) || 'ar';
    const stem = v.slice(0, -2);
    if (type === 'ar') return stem + 'a';
    return stem + 'e';
  }

  function commandExplanation(verb, form, pol) {
    const v = stripDiacritics(verb.toLowerCase());
    const type = verbType(v);
    const flip = type === 'ar' ? '(-ar → -e)' : '(-er/-ir → -a)';
    const nos = type === 'ar' ? '(-ar → -emos)' : '(-er/-ir → -amos)';

    const base = form === 'usted'
      ? `Usted commands use the present subjunctive: start from the “yo” form, drop <em>-o</em>, then flip the vowel ${flip}.`
      : `Nosotros commands: same flip + <em>-mos</em> ${nos}.`;

    const pron = pol === 'neg'
      ? 'Negative commands put pronouns <strong>before</strong> the verb.'
      : 'Affirmative commands attach pronouns to the <strong>end</strong> of the verb.';

    return `${base} ${pron}`;
  }

  function tenseExplanation(verb, tense, person, expected) {
    const v = stripDiacritics(verb.toLowerCase());
    if (IRREGULAR[tense] && IRREGULAR[tense][v]) {
      return `Irregular form: <strong>${escapeHtml(expected)}</strong> (memorize this one).`;
    }
    if (tense === 'present') {
      return 'Present tense regular endings depend on -ar/-er/-ir (stem changes may apply).';
    }
    if (tense === 'preterite') {
      return 'Preterite: completed actions (many irregulars + spelling changes exist).';
    }
    if (tense === 'imperfect') {
      return 'Imperfect: ongoing/habitual past (fewer irregulars).';
    }
    return '';
  }

  function personLabel(code) {
    return PERSONS.find(p => p.code === code)?.display || code;
  }

  function capitalize(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Expose for debugging
  window.SpanishPracticeApp = App;
  window.runAutomatedChecks = () => App.runAutomatedChecks({ startup: false });

  window.addEventListener('DOMContentLoaded', () => {
    App.init();
    const switcher = document.querySelector('.brand-switcher');
    const button = document.getElementById('appSwitcherButton');
    const menu = document.getElementById('appSwitcherMenu');
    if (switcher && button && menu) {
      button.addEventListener('click', () => { menu.hidden = !menu.hidden; button.setAttribute('aria-expanded', String(!menu.hidden)); });
      document.addEventListener('click', (event) => { if (!switcher.contains(event.target)) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
    }
    const classSwitcher = document.querySelector('.top-actions .dashboard-switcher');
    const classButton = document.getElementById('classSwitcherButton');
    const classMenu = document.getElementById('classSwitcherMenu');
    const classLabel = document.getElementById('classSwitcherLabel');
    const syncClassSwitcher = () => {
      const spanish2 = App.currentLevel === 'spanish2';
      if (classLabel) classLabel.textContent = spanish2 ? 'Spanish 2 Honors' : 'Spanish 1';
      classMenu?.querySelectorAll('[data-class]').forEach((option) => { const current = option.dataset.class === App.currentLevel; option.classList.toggle('is-current', current); option.setAttribute('aria-current', current ? 'page' : 'false'); });
    };
    if (classSwitcher && classButton && classMenu) {
      classButton.addEventListener('click', () => { classMenu.hidden = !classMenu.hidden; classButton.setAttribute('aria-expanded', String(!classMenu.hidden)); });
      classMenu.querySelectorAll('[data-class]').forEach((option) => option.addEventListener('click', () => { App.setLevel(option.dataset.class, { historyMode: 'push' }); classMenu.hidden = true; classButton.setAttribute('aria-expanded', 'false'); syncClassSwitcher(); }));
      document.addEventListener('click', (event) => { if (!classSwitcher.contains(event.target)) { classMenu.hidden = true; classButton.setAttribute('aria-expanded', 'false'); } });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { classMenu.hidden = true; classButton.setAttribute('aria-expanded', 'false'); } });
      syncClassSwitcher();
    }
  });
})();
