# Nauka od korzeni — projekt

Data: 2026-10-29 · Status: zatwierdzony w rozmowie, czeka na przegląd specu

Podprojekt 1 z 4 (kolejność: **1 od korzeni** → B wyjaśnienia obrazowe →
A mapa przedmiotu → C przykłady/zadania/kod). Każdy ma własny spec i plan.

## Cel

Lekcje mają schodzić do tego, co uczący się **naprawdę** trzyma, zanim
cokolwiek na tym zbudują — bez obniżania trudności celu. Plan robi się dłuższy
u dołu, nie łatwiejszy u góry.

## Diagnoza (z sesji MES, Loop Closure, Projekt na II)

Prompty mówią „kop głębiej”, ale trzy reguły ciągną w drugą stronę:

1. `prober/10-probe-doctrine.md` — „Enter near the top… an adult reaching for
   advanced material almost always holds the school-level basics”. Sonda nie
   schodzi poniżej pierwszego trafienia.
2. `teacher/10-planning.md` — minimalne drzewo: „nothing he already holds is
   re-taught”. Trafienie z niską pewnością / przez eliminację liczy się jako
   „trzyma” i gałąź wypada (Loop Closure: plan od pochodnej, dopiero po
   prośbie użytkownika od początku).
3. Korzenie planu są oceniane „dla niego” w głowie modelu, nie pytaniem.

## Ustalenia z rozmowy

- Tryb **zawsze włączony** — zmiana doktryny w forku, bez przełącznika
  w ustawieniach.
- Głęboka dziura → **wybór C**: nauczyciel pokazuje, jak głęboko sięga, i pyta:
  schodzić teraz czy wydzielić osobną sesję-korzeń.
- „Dlaczego?” na zaznaczonym fragmencie; przy otwartym pytaniu → **wariant (b)**:
  pomija pytanie z notatką, objazd, potem to samo sprawdzenie ponownie.

## 1. Doktryna (prompty)

### Sonda — `src/agent/prompts/prober/10-probe-doctrine.md`

- Usunąć „Enter near the top, not the bottom” wraz z założeniem o szkolnych
  podstawach. Zamiast tego: wejście na poziomie celu, a każda nitka jest
  bracketowana **w dół do potwierdzonej podłogi**.
- **Potwierdzona podłoga** = poprawna odpowiedź z **wysoką pewnością** (≥ 70%
  na suwaku pewności) **i** sensownym tokiem w polu thinking. Poprawna z niską
  pewnością, przez eliminację albo zgadnięta = **sufit**, nie podłoga.
- „Strands inform each other” zostaje tylko w górę (silna nitka może podnieść
  start sąsiedniej), nigdy jako zwolnienie z potwierdzenia podłogi.
- Opis pola `assessment` w `probeDoneInputSchema`
  (`src/core/contracts/probe.ts`) dostaje wymóg: potwierdzona podłoga
  z dowodem + **głębokość dziury** (ile warstw fundamentów leży między
  podłogą a tym, czego potrzebuje cel). Kształt schematu bez zmian.

### Planowanie — `teacher/10-planning.md` + `teacher/05-method.md`

- Minimalne drzewo zostaje (nic poza ścieżką do celu), ale „już trzyma” =
  **tylko potwierdzona podłoga**. Wszystko chwiejne wchodzi do planu.
- Korzenie planu = rzeczy potwierdzone przez sondę albo naprawdę bezwarunkowe;
  „Stress-test the roots” w razie wątpliwości schodzi w dół, nie zakłada.
- **Reguła C (głęboka dziura):** jeśli fundament, którego brakuje, sam
  potrzebuje **3+ węzłów planu**, to przed prezentacją planu nauczyciel pyta
  `ask_user_question`, pokazując, co leży pod spodem. Opcje:
  „schodzimy w tej sesji” / „wydzielamy «X od zera» do osobnej sesji, tu
  zaczynamy od X jako założenia”. Mniejsze dziury wchodzą do planu bez pytania.

### Nauczanie — `teacher/20-teaching.md`

- **Każdy korzeń planu jest potwierdzony `quiz`-em przed budowaniem** na nim
  (dotąd „briefly check” — teraz obowiązek, nie ocena w głowie).
- Pomyłka w trakcie lekcji, która odsłania brak pod spodem → ta sama reguła C:
  mała dziura = objazd od razu, duża = pytanie o sesję-korzeń.
- Wiadomość „Dlaczego „…”?” (sekcja 3) = prośba o zejście o **jeden poziom**
  pod ten fragment: nazwij fakt, na którym stoi → sprawdź pytaniem, czy jest
  trzymany → jeśli nie, zejdź (objazd albo reguła C) → wróć wprost do miejsca
  przerwania. Jeśli prośba przyszła przez pominięte pytanie (wariant b), po
  objeździe **zadaj to sprawdzenie ponownie**.

Bez zmian: jeden krok = jedno sprawdzenie, rytm predict → step → check,
zasady pytań, trudność celu.

## 2. Sesja-korzeń — narzędzie `foundation_session`

Wzorzec jak `probe_done`/`demo`: narzędzie + karta + wpis w
`components/artifacts/index.ts`. Tylko w zestawie nauczyciela.

- Wejście: `title` (krótko, np. „Macierze od zera”), `goal` — pierwsza
  wiadomość nowej sesji, pisana jako cel uczącego się: po co (dla której
  sesji/celu), co wykazała sonda (podłoga, sufit, chwiejne miejsca), „od
  samych podstaw”.
- Serwer tylko potwierdza (stały ack, jak `PROBE_DONE_ACK_TEXT`), nic nie
  tworzy — brak pustych sesji.
- Karta: tytuł, jedno zdanie „po co”, przycisk **„Otwórz sesję-korzeń”** →
  istniejące `startDraftSession(goal, fetch)` → nawigacja do nowej sesji.
  Rodzic zostaje w pasku bocznym.
- Prompt (`teacher/10-planning.md`): narzędzie wolno wywołać tylko po wyborze
  „osobna sesja” w regule C. Potem X jest pożyczonym korzeniem: nauczyciel uczy
  dalej i mówi, które kroki na nim stoją; po powrocie zwykłe potwierdzenie
  korzenia (sekcja 1) rozstrzyga, czy idziemy dalej.
- Poza zakresem (→ podprojekt A): link powrotny, status „ukończony”, drzewo
  sesji.

## 3. Przycisk „Dlaczego?”

- Zaznaczenie tekstu wewnątrz wiadomości nauczyciela (proza, wzór KaTeX,
  fragment listy) → mały pływający przycisk **„Dlaczego?”** przy zaznaczeniu.
  Znika po odznaczeniu/scrollu/Escape. Nie dotyczy wiadomości użytkownika,
  kart narzędzi ani demo.
- Klik → kompozytor dostaje `Dlaczego „<fragment>”?`, fokus, kursor na końcu.
  Fragment: tekst zaznaczenia ze zwiniętymi białymi znakami, obcięty do
  300 znaków z „…”. Wysyłka istniejącą ścieżką `doSteerOrSend` (steer w trakcie
  tury, zwykła wiadomość poza nią). Istniejąca treść kompozytora nie ginie —
  prośba jest dopisywana w nowej linii.
- **Otwarte pytanie (wariant b):** klik najpierw pomija pytanie istniejącą
  ścieżką `dismissQuestion` z `readingThinking` = `Nie rozumiem: „<fragment>”`
  (mid-turn: jak dziś, z abortem tury), potem wypełnia kompozytor.
- Etykiety po polsku; komponent osobno (np. `components/why-button.tsx`),
  podpięcie w `chat.tsx` minimalne.

## Testy

- Jednostkowe: budowanie tekstu prośby (białe znaki, obcięcie, LaTeX,
  dopisanie do niepustego kompozytora); wybór steer/send; wariant (b) woła
  dismiss z notatką; `foundation_session` — schemat, ack, karta woła
  `startDraftSession` z `goal`; tylko nauczyciel ma narzędzie.
- Kompozycja promptów: nowe reguły w składzie prober/teacher, stare
  („Enter near the top”) nieobecne.
- `npm test` (izolowany) + `npm run lint` + build.
- Ręcznie: nowa sesja „LM do Loop Closure” — sonda schodzi do potwierdzonej
  podłogi, pada pytanie C, karta otwiera sesję-korzeń, „Dlaczego?” robi objazd
  i wraca (także przy otwartym pytaniu).

## Ryzyka

- Konflikty przy merge'ach z upstreamu w plikach promptów — zmiany trzymać
  w wyraźnych, zwartych akapitach.
- Dłuższe sondy i plany = więcej tokenów na sesję; świadomy koszt.
- Model (DeepSeek V4) może ignorować regułę C tak jak dziś ignoruje `demo` —
  ręczna próba to sprawdza; w razie potrzeby twardsze sformułowanie.
