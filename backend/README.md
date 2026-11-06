# Backend del Hub (Apps Script "MirComm HUB")

Esta carpeta es **todo** el backend. Desde v64 se cambia aquí (GitHub), no en el editor de Apps Script.
GitHub lo sube y lo despliega solo con `clasp`.

| Cuándo | Qué pasa |
|---|---|
| Cada cambio en `backend/` que llega a `main` | Revisa la sintaxis, sube el código y actualiza la **deployment de prueba** (solo la usa tu vista previa de manager). |
| Actions → **Backend deploy** → Run workflow → `production` | Actualiza el **Hub de todos** (la misma URL de siempre, nueva versión). |

> ⚠️ No edites en el editor de Apps Script. Si alguien lo hace, el deploy se detiene y muestra la diferencia en vez de borrarla.
> Los triggers (resumen diario, importar correos) corren el código más nuevo que se subió, aunque producción siga en la versión anterior. Por eso los cambios del backend siempre deben ser compatibles con lo que ya existe (así está hecha la Fase 2: solo agrega acciones nuevas).

## Conectar GitHub con Google (una sola vez, ~5 min)

1. Abre <https://script.google.com/home/usersettings> y prende **Google Apps Script API**.
2. En tu computadora (necesita Node.js): abre Terminal / PowerShell y corre
   `npx @google/clasp@2.4.2 login` → se abre el navegador → entra con **mircommllc@gmail.com** → **Allow**.
   Eso crea el archivo `.clasprc.json` en tu carpeta de usuario (`C:\Users\TU_USUARIO\.clasprc.json` o `~/.clasprc.json`).
3. En GitHub: repo → **Settings → Secrets and variables → Actions**
   - **Secrets** → New repository secret → nombre `CLASPRC_JSON` → pega todo el contenido de ese archivo.
   - **Variables** → New repository variable → nombre `PROD_DEPLOYMENT_ID` → el ID de la URL del Hub que ya usas
     (en ⚙ Configure: lo que va entre `/macros/s/` y `/exec`, empieza con `AKfy…`).
4. Actions → **Backend deploy** → Run workflow → `test`. Al terminar, el resumen del run te da:
   - el ID para la variable `TEST_DEPLOYMENT_ID` (agrégala igual que el paso 3), y
   - la **Test backend URL** para pegar en el Hub → ⚙ Configure (solo con tu PIN de manager).

## Probar y publicar la Fase 2

1. Hub → ⚙ Configure → prende **🧪 Phase 2 preview** (y pega la Test backend URL). Solo tú lo ves; arriba sale "🧪 Preview".
2. Cuando todo esté bien: Actions → Backend deploy → `production`, y en `index.html` cambia `P2_FOR_ALL = false` a `true`.

## Revisar antes de subir

`node tools/check-backend.mjs` — junta los .gs como Apps Script (un solo espacio global) y avisa de errores de sintaxis o funciones repetidas.

## Archivos nuevos en v64

- `Lineas.gs` — un solo formulario de líneas (`actRepLineSave`): asesoras y administradores, y une la línea al registro del correo de Spectrum para que el internet no quede doble.
- `Buscar.gs` — índice de la búsqueda global Ctrl K (`getSearchIndex`).
- `Clientes.gs` — `getCustomerSummary` y `getCustomerHistory` (el resumen de clientes ya no se calcula en el navegador).

## Archivos nuevos en v65

- `PagosCellmart.gs` — lee los avisos de QuickBooks ("CellMart, LLC has scheduled a payment") y los correos de Cellmart que explican cada pago (residual, incentivo, SMB, spiff, comisión aplicada a factura), los guarda en la hoja `PagosCellmart` y los liga. Se revisa solo cada 15 min desde `importSpectrumOrders`; la primera vez carga desde junio 2026. Acciones: `getCellmartPayments`, `pagRescan`.
