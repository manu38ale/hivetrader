# Bot HIVE/HBD del mercado interno

Proceso Node.js independiente del dashboard. Solo construye `limit_order_create`
y `limit_order_cancel`, ambos con autoridad **ACTIVE**. No usa conversiones,
exchanges externos, margen ni apalancamiento. No promete rentabilidad.

## Cuenta dedicada y recursos

1. Crea una cuenta Hive nueva mediante un proveedor de creación de cuentas de
   confianza o una cuenta con créditos de creación. Usa un nombre exclusivo para
   este bot; **no uses tu cuenta personal**.
2. Guarda owner/recovery offline. Mantén las claves owner, posting y memo fuera
   del proceso. Instala solo la clave privada ACTIVE de la cuenta bot en el
   servidor. El bot no crea cuentas ni modifica autoridades.
3. Desde una wallet, haz power up de una cantidad pequeña de HIVE en la cuenta
   bot, o delega Hive Power a esa cuenta para obtener Resource Credits (RC).
   También puedes delegar RC mediante las herramientas compatibles de Hive.
   Verifica RC disponibles antes de habilitar trading; cancelar y crear consume RC.
4. Transfiere cantidades pequeñas de **HIVE y HBD líquidos**, no savings.
   El Hive Power delegado no es inventario negociable. Empieza cerca del objetivo
   de inventario calculado al precio medio; un desequilibrio grande puede bloquear
   ambas cotizaciones por la protección contra cruzar el libro.
5. No uses otra instancia, wallet o bot para crear órdenes en esta cuenta:
   la reconciliación toma control de **todas** sus órdenes HIVE/HBD.

## Instalación y paper

Requiere Node.js >=22.9 con `--env-file-if-exists`.
Desde la raíz:

```sh
npm --prefix bot ci
cp bot/.env.example bot/.env
chmod 600 bot/.env
```

Edita `bot/.env`: configura `BOT_ACCOUNT` con el nombre público de la cuenta
dedicada. En paper **no hace falta una clave**; deja `BOT_ACTIVE_KEY` vacío.

```sh
npm test
npm --prefix bot run typecheck
npm run paper
# Prueba acotada de cinco minutos, siempre forzada a paper:
RUN_DURATION_SEC=300 npm run paper
```

`npm run paper` fuerza paper incluso si `.env` dice `PAPER_MODE=false`.
El modo por defecto de `dev`/`start` también es paper; solo la cadena exacta
`PAPER_MODE=false` permite operar. No se interpreta ni valida una clave en paper.
Los logs JSON incluyen mid, spread, skew, motivo, cancelaciones, cotizaciones y
estado de breakers. `paper_operations` contiene `signed:false,broadcast:false`.
Si el spread real es menor del 1%, es correcto no cotizar.

Paper lee libro real (50 niveles), órdenes abiertas y balances cada ciclo.
Usa balances observados al inicio, o los overrides `PAPER_HIVE`/`PAPER_HBD`.
Mantiene reservas y órdenes **virtuales** para comprobar la reconciliación, sin
modificar las órdenes reales y sin simular fills: para fills usa el backtest.
Al reiniciar paper se reinicia ese inventario virtual; usa otro `STATE_DIR` para
una simulación nueva si necesitas otra base de riesgo. No reutilices estado live.

## Configuración de estrategia

Los sufijos `PCT` son fracciones: `0.01` significa 1%, no 0.01%.
Precio: HBD por HIVE. Todos los activos enviados tienen tres decimales.

| Variable | Default |
|---|---:|
| POLL_INTERVAL_SEC | 15 |
| QUOTE_SIZE_PCT | 0.05 |
| MIN_SPREAD_PCT | 0.01 |
| REQUOTE_THRESHOLD_PCT | 0.002 |
| INVENTORY_TARGET_HBD_PCT | 0.5 |
| SKEW_GAIN | 1.0 |
| ORDER_EXPIRATION_MIN | 60 |
| TOXIC_MOVE_PCT | 0.02 |
| TOXIC_WINDOW_MIN | 10 |
| PAUSE_MIN | 30 |
| MAX_DAILY_LOSS_HBD | 5 |
| PAPER_MODE | true |

`RPC_NODES` es una lista de URLs HTTPS separadas por comas. Las lecturas rotan
al fallar un nodo. `PRICE_TICK=0.000001` es una convención configurable de
cotización, **no un tick universal del protocolo** (Hive usa razones de activos).
Se mejora un tick por lado solo si caben ambos sin cruzarse.

El tamaño por lado usa balance líquido + su importe reservado en órdenes
existentes. No se gastan fondos de savings ni vesting. El sesgo implementa
literalmente `skew=(ratioHBD-target)*gain` y multiplica ambos precios por
`1-skew`. Ese signo puede alejar el inventario del objetivo en vez de corregirlo;
no se ha invertido respecto de la especificación. Revisa este comportamiento en
paper. Si el precio sesgado cruza la mejor punta contraria no se cotiza, en vez
de tomar liquidez. Redondear la recepción hacia arriba protege el límite.
Un movimiento entre snapshot y broadcast todavía puede producir un fill
inmediato: Hive no ofrece post-only en esta operación.

Se conserva una orden por lado mientras el mid no cambie **más de** el umbral
desde su creación y no expire. Fills/órdenes ausentes reponen la punta faltante;
duplicados y órdenes sin metadata se cancelan y reconcilian. Por seguridad,
spread insuficiente, breaker, snapshot inválido o salida cancelan órdenes,
aunque no se haya alcanzado el umbral de re-cotización.

## Riesgo persistente y revisión manual

Equity HBD = HBD líquido/reservado + HIVE líquido/reservado * mid.
Pérdida diaria = equity actual menos equity de la primera observación del día
UTC. El baseline cambia al primer polling posterior a las 00:00 UTC (no se
inventa una valoración exacta si el bot estaba apagado). Incluye P&L no realizado;
no incluye HP, savings ni recompensas. **No fondees ni retires mientras opera**:
un retiro se contabilizaría como pérdida y un depósito puede ocultarla.

Un movimiento absoluto del mid superior a 2% contra cualquiera de las muestras
de los últimos diez minutos pausa treinta minutos. La pérdida diaria superior
a 5 HBD activa un latch de revisión manual. Se cancelan órdenes durante pausas;
el latch no se borra por reinicio ni por el cambio de día. Un broadcast incierto
también activa ese latch; no se reintenta creando IDs nuevos.

Estado y contador se guardan atómicamente antes de emitir operaciones en
`.state/<cuenta>-live.json` o `-paper.json`. El lock impide dos instancias sobre
el mismo estado. **Usa siempre el mismo directorio persistente para esa cuenta**;
no ejecutes procesos en máquinas distintas sin exclusión externa.
No borres el estado al desplegar: conserva `lastOrderId` y `anchors`.
Los IDs uint32 se generan desde segundos Unix más un contador monotónico
persistido; toleran múltiples órdenes en el mismo segundo y retrocesos de reloj.

Para reanudar tras un latch:

1. Detén el proceso y verifica órdenes, balances, RC y transacciones en cadena.
   Ante un broadcast incierto, espera también la expiración de su transacción
   (normalmente un minuto) antes de decidir sobre el resultado.
2. Determina la causa y si es seguro continuar. Cancela manualmente cualquier
   orden residual. Si se alcanzó el límite diario, espera el siguiente día UTC
   o autoriza conscientemente otro presupuesto antes de continuar.
3. Con el proceso detenido, edita únicamente `risk.halted` a `false` en el JSON
   correspondiente. Conserva el baseline: si continúa excediendo el límite,
   se volverá a pausar. No borres IDs ni anchors para desactivar el riesgo.
4. Si hubo caída abrupta, elimina solo el `.lock` de esa cuenta después de
   confirmar que su PID ya no existe. Un lock fallido detiene el arranque.

Si los RPC no responden, **no puede garantizarse cancelar en cadena**. Se
reporta `cancel_failed`; las órdenes tienen expiración on-chain y debes revisarlas.
No uses `SIGKILL` para una parada normal. Los errores no exponen la clave ni
imprimen la excepción de firma/broadcast.

## Habilitar real

Solo después de revisar los resultados paper y con fondos limitados:

```sh
cd bot
npm run build
# Configura en el entorno privado del servicio:
# BOT_ACCOUNT=<cuenta dedicada>, BOT_ACTIVE_KEY=<ACTIVE privada>, PAPER_MODE=false
npm start
```

`npm start` no fuerza paper; requiere `PAPER_MODE=false` explícito para firmar.
El frontend no inicia, detiene ni firma operaciones. Nunca copies la clave a
`.env` del frontend ni a variables `VITE_*`. Los archivos `.env*`, secretos,
claves y estado están ignorados; `.env.example` contiene solo placeholders.
Gitignore no protege archivos ya versionados: comprueba el staging antes de
cada commit. Si expones una clave, rótala inmediatamente con tu wallet.

## Backtest de treinta días

```sh
# Desde la raíz:
npm run backtest
# Fecha de corte UTC opcional y balances explícitos:
BACKTEST_DAYS=30 BACKTEST_END=2026-10-18T00:00:00Z \
  BACKTEST_HIVE=1000 BACKTEST_HBD=50 npm run backtest
```

Usa `market_history_api.get_trade_history` (plugin market_history) por días,
dividiendo ventanas de 1000 resultados recursivamente hasta un segundo. Nunca
avanza un cursor descartando trades con el mismo timestamp. Si un segundo
satura el límite, o falta un día entero, falla explícitamente; no reporta
treinta días sobre una muestra truncada. Usa RPC con historial suficiente.

**Limitación fundamental**: el historial de trades no contiene snapshots del
libro ni la cola. Se reconstruye un libro sintético de spread constante
`BACKTEST_SPREAD_PCT=0.012`, usando solo el último precio conocido. Es un
replay de escenarios, no una medición del spread histórico real. Ninguna orden
usa un trade futuro ni se llena con el mismo trade que originó su cotización.
Los fills requieren cruce y dirección del taker compatibles, están limitados
al volumen del trade y permiten fills parciales, pero no modelan prioridad
de cola, latencia ni RC. Pueden sobreestimar ejecuciones.

`BACKTEST_HIVE` default 1000; sin `BACKTEST_HBD` se calcula el balance HBD que
cumple el objetivo de inventario al primer trade. Para objetivo 100% HBD se
usa fallback explícito de 100 HBD; configura ambos balances para ese extremo.
El resultado JSON incluye:

- `pnlHbd`: equity final menos inicial, marcado al último trade.
- `fills`: número de ejecuciones parciales simuladas.
- `averageCapturedSpreadHbdPerHive` y `averageCapturedSpreadPct`: diferencia
  venta-compra de lotes emparejados FIFO, ponderada por HIVE. `null` si no hay
  ninguna vuelta completa; no se presenta un cero como spread observado.
- `maxDrawdownHbd`: caída máxima desde un máximo de equity, incluyendo mercado.
- `finalInventory`: HIVE/HBD, incluyendo reservas de órdenes.
- Fechas solicitadas/observadas, cantidad de trades, supuesto de spread y latch.

Las órdenes virtuales, expiración, skew, umbrales y breakers usan las mismas
funciones puras de strategy/risk que el proceso. Una pausa de pérdida puede
dejar inventario expuesto: cancelar órdenes no liquida HIVE.

## Proceso continuo

Despliega solo `bot/` (no necesita Vite); ejecuta `npm ci && npm run build`.
Usa un usuario de SO sin privilegios, almacenamiento persistente para `.state`,
hora UTC sincronizada y un gestor como systemd, launchd o un contenedor con
política de reinicio. Configura directorio de trabajo `.../hivetrader/bot`,
comando `/ruta/node --env-file=.env dist/index.js`, entorno privado y
`TimeoutStopSec=90` si usas systemd. Envía SIGTERM para detener: cancela órdenes
antes de liberar el lock. Mantén logs JSON con rotación y alertas para
`cycle_failed`, `cancel_failed` y `daily loss breaker`.

No pongas la clave en argumentos de shell, imágenes, archivos de servicio
versionados o logs. Preferiblemente inyéctala mediante el almacén de secretos
del host como variable `BOT_ACTIVE_KEY`. La biblioteca puede reintentar el
mismo envío firmado ante errores de transporte; el ejecutor no emite una nueva
transacción con IDs distintos para resolver incertidumbre.

## Dashboard

Configura solo `VITE_BOT_ACCOUNT` en el `.env` de la raíz y reinicia Vite.
El menú principal separa **Análisis histórico** (`#/analysis`) y **Trading del bot**
(`#/bot`). La primera vista conserva el selector, filtros y resumen anteriores.
La segunda abre la cuenta configurada o permite ingresar otra cuenta dedicada.
El parser `fill_order` y el resumen HBD del análisis se mantienen intactos.
El libro público en la página del bot muestra diez niveles por lado y refresca cada 15 s.
El neto de HBD del dashboard es flujo de caja, no equity mark-to-market; no
debe confundirse con el límite diario del bot.

La tarjeta de referencia usa exclusivamente el feed mediano on-chain
`condenser_api.get_current_median_history_price`, mostrando HIVE en HBD y su
recíproco (HBD en HIVE), sin cotizaciones externas en USD ni precios de respaldo.
El bot **no usa ese feed para operar**: cotizaciones, skew, equity y pérdidas
diarias se calculan con el mid del libro interno, en HBD. El backtest usa precios
de trades on-chain. Un HBD es una unidad de cuenta, no una cotización externa
convertida a dólares.

La página del bot muestra, en este orden:

1. Resumen de HBD/HIVE actuales, con disponibles y reservas separados; valor
   total en HBD, volumen bruto y resultado de trading del período.
2. Órdenes abiertas: lado, importes pendientes, precio HBD/HIVE y expiración.
3. Ejecuciones on-chain, paginadas de 25 en 25.

El selector de período ofrece 24 horas, 7 días, 30 días y todo el historial.
Volumen = suma de compras y ventas, una vez por fill, en ambas monedas.
Resultado = HBD neto de los fills + HIVE neto de los fills × mid actual del libro.
Incluye posición sin cerrar del período, no depósitos ni la revalorización del
inventario anterior al período. No es P&L FIFO realizado ni equivale al breaker
diario del proceso. Los self-trades cuentan volumen pero tienen resultado neto
cero. El balance siempre es actual y excluye savings/HP.

Balances y órdenes refrescan cada 15 s; ejecuciones cada 60 s. El historial se
pagina hasta cubrir el período, incluyendo timestamps iguales y el índice cero.
Si falla una página o se superan 100.000 entradas, se informa el error sin
mostrar un resultado parcial; selecciona un período menor para cuentas grandes.
Cambiar de cuenta o período aborta las peticiones anteriores.

Esta página no conoce el estado local del proceso ni puede mostrar las órdenes
virtuales de paper. Solo observa actividad real en cadena; no inicia, detiene,
cancela ni firma operaciones. La active key sigue exclusivamente en el entorno
del proceso Node.js, nunca en el frontend.
