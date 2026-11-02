# Probabilità gol del Match Predictor: audit 2 novembre 2026

Questo repository pubblica `assets/data/match-predictor/YYYY-MM-DD.json`, il
feed letto dal PDF quotidiano. Il modello precedente scartava una media gol
pari a zero, pesava allo stesso modo stagioni con poche e molte partite, e
applicava aumenti manuali alle probabilità O2.5/O3.5.

La correzione conserva gli zeri, riduce le medie con pochi incontri verso i
prior di 1,59 gol casa e 1,32 fuori (peso quattro gare), poi combina Poisson
e quote. I coefficienti sono stati ricavati sui RAW dicembre 2025–luglio 2026
del repository `PronosticiBomba`; in presenza di O2.5 e U2.5 usa la quota
senza margine, per O3.5 la quota Over disponibile. Quando manca una quota
utilizzabile, usa la Poisson corretta. Il resto dei mercati necessita una
validazione separata, benché condivida le lambda.

`tools/audit_goal_cache_history.py` confronta il *primo asset pubblicato* per
ogni giorno di agosto–ottobre con i risultati FT API-Football e con i RAW
conservati in Supabase. Considera solo fixture non iniziate alla pubblicazione
e kickoff fra 11:30 e 20:30 Europe/Dublin, dopo la raccolta dei RAW. Esclude
AET/PEN; usa quote snapshot, non prezzi effettivamente eseguiti.

| Mese | Mercato | Fixture | Brier sito precedente | Brier corretto | Brier mercato |
| --- | --- | ---: | ---: | ---: | ---: |
| Agosto | O2.5 | 5.240 | 0,24288 | 0,23216 | 0,23273 |
| Agosto | O3.5 | 3.631 | 0,23055 | 0,21362 | 0,21383 |
| Settembre | O2.5 | 5.538 | 0,24412 | 0,23542 | 0,23557 |
| Settembre | O3.5 | 3.617 | 0,23172 | 0,21707 | 0,21793 |
| Ottobre | O2.5 | 6.329 | 0,24064 | 0,23448 | 0,23476 |
| Ottobre | O3.5 | 3.943 | 0,23313 | 0,21958 | 0,22058 |

La correzione riduce l'errore probabilistico in tutti e tre i mesi. Il
miglioramento rispetto alle sole quote è piccolo. Una classifica meccanica
dei dieci edge stimati più alti per giorno, ignorando gli altri controlli del
PDF, non ha un ROI stabile: +0,64% agosto, −2,17% settembre, +0,23% ottobre.
Questa prova non dimostra un vantaggio sui bookmaker né misura il ROI del PDF.

L'output mantiene `p_over25`, `p_over35`, `lam_home` e `lam_away` per i
consumer esistenti. I vecchi punteggi euristici calcolati sulle nuove lambda
sono disponibili come `p_over25_heuristic` e `p_over35_heuristic` per diagnosi;
non rappresentano le vecchie probabilità pubblicate. Il campo
`goal_model_version` identifica la nuova generazione.

Il workflow orario aggiorna un file esistente senza rigenerare le probabilità.
Dopo il merge serve un `workflow_dispatch` in modalità `build` per la data
corrente, seguito da lettura del JSON pubblicato e verifica del PDF. La
correzione del runtime PB40 nel repository principale resta separata.
